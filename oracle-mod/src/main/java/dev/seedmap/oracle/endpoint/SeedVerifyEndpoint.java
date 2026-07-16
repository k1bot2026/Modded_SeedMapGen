package dev.seedmap.oracle.endpoint;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import dev.seedmap.oracle.http.ApiError;
import dev.seedmap.oracle.http.HttpJson;
import dev.seedmap.oracle.world.Dimensions;
import dev.seedmap.oracle.world.PlacementScan;
import dev.seedmap.oracle.world.ServerTasks;
import net.minecraft.registry.DynamicRegistryManager;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.server.MinecraftServer;
import net.minecraft.structure.StructureSet;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.ChunkPos;
import net.minecraft.world.biome.source.util.MultiNoiseUtil;
import net.minecraft.world.gen.chunk.ChunkGeneratorSettings;
import net.minecraft.world.gen.chunk.NoiseChunkGenerator;
import net.minecraft.world.gen.chunk.placement.StructurePlacementCalculator;
import net.minecraft.world.gen.noise.NoiseConfig;
import net.minecraft.world.gen.structure.Structure;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * POST /seed/verify — check candidate seeds against observations without touching live
 * server state or restarting anything.
 *
 * Biome observations: a fresh NoiseConfig is built for the candidate seed exactly the way
 * vanilla builds the live one (NoiseChunkGenerator settings, or missing-settings for other
 * generator types, plus the NOISE_PARAMETERS lookup), and its multi-noise sampler is fed to
 * the dimension's real BiomeSource.
 *
 * Structure observations: a candidate-seeded StructurePlacementCalculator is created via
 * ChunkGenerator#createStructurePlacementCalculator (fully seed-parameterizable; nothing is
 * bound to the live seed). Game-accurate per the contract: match = the vanilla per-start-chunk
 * outcome for the observation's chunk names the expected type — the game's shouldGenerate
 * marks the chunk as a start chunk, the vanilla weighted elimination draw for multi-entry
 * structure sets (PlacementScan#weightedWinner) picks the expected structure, and its real
 * StructureStart computes with the candidate-seeded noise/placement.
 *
 * Bedrock observations are v1.5 (throwaway-world generation): reported per-detail as
 * {"match": null, "unsupported": true} and excluded from matches/total.
 */
public final class SeedVerifyEndpoint {
    private static final int MAX_CANDIDATES = 16;
    private static final int MAX_OBSERVATIONS = 256;

    private record CandidateContext(
            Dimensions.Context live,
            NoiseConfig noiseConfig,
            MultiNoiseUtil.MultiNoiseSampler sampler,
            StructurePlacementCalculator calculator
    ) {
    }

    private final MinecraftServer server;
    private final Dimensions dimensions;

    public SeedVerifyEndpoint(MinecraftServer server, Dimensions dimensions) {
        this.server = server;
        this.dimensions = dimensions;
    }

    public void handle(HttpExchange exchange) throws IOException {
        JsonObject request = HttpJson.readJsonBody(exchange);
        JsonArray candidates = requireArray(request, "candidates");
        JsonArray observations = requireArray(request, "observations");
        if (candidates.size() > MAX_CANDIDATES) {
            throw ApiError.tooLarge("at most " + MAX_CANDIDATES + " candidates");
        }
        if (observations.size() > MAX_OBSERVATIONS) {
            throw ApiError.tooLarge("at most " + MAX_OBSERVATIONS + " observations");
        }

        long[] seeds = new long[candidates.size()];
        for (int i = 0; i < candidates.size(); i++) {
            JsonElement el = candidates.get(i);
            if (!el.isJsonPrimitive()) {
                throw ApiError.badParam("candidates must be seed strings");
            }
            try {
                seeds[i] = Long.parseLong(el.getAsString().trim());
            } catch (NumberFormatException e) {
                throw ApiError.badParam("candidate seed is not a 64-bit integer: " + el.getAsString());
            }
        }

        JsonArray results = ServerTasks.onServerThread(server, () -> {
            JsonArray out = new JsonArray();
            for (int i = 0; i < seeds.length; i++) {
                out.add(verifyCandidate(candidates.get(i).getAsString(), seeds[i], observations));
            }
            return out;
        });

        JsonObject body = new JsonObject();
        body.add("results", results);
        HttpJson.sendJson(exchange, 200, body);
    }

    /** Must run on the server thread (registry + generator access). */
    private JsonObject verifyCandidate(String seedString, long seed, JsonArray observations) {
        Map<String, CandidateContext> contexts = new HashMap<>();
        int matches = 0;
        int total = 0;
        JsonArray details = new JsonArray();

        for (int index = 0; index < observations.size(); index++) {
            JsonElement el = observations.get(index);
            if (!el.isJsonObject()) {
                throw ApiError.badParam("observation " + index + " must be an object");
            }
            JsonObject obs = el.getAsJsonObject();
            String type = HttpJson.requireString(obs, "type");

            JsonObject detail = new JsonObject();
            detail.addProperty("index", index);
            switch (type) {
                case "biome" -> {
                    CandidateContext ctx = contexts.computeIfAbsent(
                            HttpJson.requireString(obs, "dim"), dim -> candidateContext(dim, seed));
                    int x = HttpJson.requireInt(obs, "x");
                    int y = HttpJson.requireInt(obs, "y");
                    int z = HttpJson.requireInt(obs, "z");
                    String expected = HttpJson.requireString(obs, "expected");
                    String actual = ctx.live().biomeSource()
                            .getBiome(x >> 2, y >> 2, z >> 2, ctx.sampler())
                            .getIdAsString();
                    boolean match = actual.equals(expected);
                    detail.addProperty("match", match);
                    detail.addProperty("actual", actual);
                    total++;
                    if (match) {
                        matches++;
                    }
                }
                case "structure" -> {
                    CandidateContext ctx = contexts.computeIfAbsent(
                            HttpJson.requireString(obs, "dim"), dim -> candidateContext(dim, seed));
                    int x = HttpJson.requireInt(obs, "x");
                    int z = HttpJson.requireInt(obs, "z");
                    String expected = HttpJson.requireString(obs, "expected");
                    boolean match = structurePlaced(ctx, expected, x >> 4, z >> 4);
                    detail.addProperty("match", match);
                    if (match) {
                        detail.addProperty("actual", expected);
                    } else {
                        detail.add("actual", JsonNull.INSTANCE);
                    }
                    total++;
                    if (match) {
                        matches++;
                    }
                }
                case "bedrock" -> {
                    detail.add("match", JsonNull.INSTANCE);
                    detail.addProperty("unsupported", true);
                }
                default -> throw ApiError.badParam(
                        "observation " + index + " has unknown type: " + type);
            }
            details.add(detail);
        }

        JsonObject result = new JsonObject();
        result.addProperty("seed", seedString);
        result.addProperty("matches", matches);
        result.addProperty("total", total);
        result.addProperty("verdict", matches == total && total > 0 ? "match" : "mismatch");
        result.add("details", details);
        return result;
    }

    /**
     * Builds the candidate-seed worldgen context for one dimension, mirroring vanilla's
     * ServerChunkLoadingManager constructor: NoiseConfig.create(settings, noiseParams, seed)
     * then ChunkGenerator#createStructurePlacementCalculator(structureSets, noiseConfig, seed).
     */
    private CandidateContext candidateContext(String dim, long seed) {
        Dimensions.Context live = dimensions.get(server, dim);
        DynamicRegistryManager registryManager = server.getRegistryManager();
        ChunkGeneratorSettings settings = live.generator() instanceof NoiseChunkGenerator noiseGenerator
                ? noiseGenerator.getSettings().value()
                : ChunkGeneratorSettings.createMissingSettings();
        NoiseConfig noiseConfig = NoiseConfig.create(
                settings, registryManager.getWrapperOrThrow(RegistryKeys.NOISE_PARAMETERS), seed);
        StructurePlacementCalculator calculator = live.generator().createStructurePlacementCalculator(
                registryManager.getWrapperOrThrow(RegistryKeys.STRUCTURE_SET), noiseConfig, seed);
        return new CandidateContext(live, noiseConfig, noiseConfig.getMultiNoiseSampler(), calculator);
    }

    /**
     * Game-accurate: would the game, generating with the candidate seed, place a structure of
     * the expected type in this chunk? Mirrors ChunkGenerator#setStructureStarts per structure
     * set — shouldGenerate gate, then the vanilla weighted elimination draw whose winner must
     * be the expected structure with a computable start.
     */
    private boolean structurePlaced(CandidateContext ctx, String structureId, int chunkX, int chunkZ) {
        Registry<Structure> registry = server.getRegistryManager().get(RegistryKeys.STRUCTURE);
        Identifier id = Identifier.tryParse(structureId);
        Optional<RegistryEntry.Reference<Structure>> entry =
                id == null ? Optional.empty() : registry.getEntry(id);
        if (entry.isEmpty()) {
            throw ApiError.unknownStructure(structureId);
        }
        Structure expected = entry.get().value();
        // Cheap exact short-circuit (vanilla's hasValidBiome pattern): a structure with no
        // valid biome anywhere in this dimension can never compute a start.
        if (expected.getValidBiomes().stream()
                .noneMatch(ctx.live().biomeSource().getBiomes()::contains)) {
            return false;
        }
        ChunkPos chunkPos = new ChunkPos(chunkX, chunkZ);
        for (RegistryEntry<StructureSet> setEntry : ctx.calculator().getStructureSets()) {
            StructureSet set = setEntry.value();
            if (set.structures().stream().noneMatch(weighted -> weighted.structure().value() == expected)) {
                continue;
            }
            if (!set.placement().shouldGenerate(ctx.calculator(), chunkX, chunkZ)) {
                continue;
            }
            StructureSet.WeightedEntry winner = PlacementScan.weightedWinner(
                    set, ctx.calculator().getStructureSeed(), chunkPos,
                    weighted -> computesCandidateStart(ctx, weighted.structure().value(), chunkPos));
            if (winner != null && winner.structure().value() == expected) {
                return true;
            }
        }
        return false;
    }

    /**
     * Candidate-seeded equivalent of ChunkGenerator#trySetStructureStart: the same registries,
     * generator and template manager as the live world, but the candidate NoiseConfig and the
     * candidate calculator's structure seed (references=0 for an ungenerated chunk).
     */
    private boolean computesCandidateStart(CandidateContext ctx, Structure structure, ChunkPos chunkPos) {
        return structure.createStructureStart(
                server.getRegistryManager(),
                ctx.live().generator(),
                ctx.live().biomeSource(),
                ctx.noiseConfig(),
                server.getStructureTemplateManager(),
                ctx.calculator().getStructureSeed(),
                chunkPos,
                0,
                ctx.live().world(),
                structure.getValidBiomes()::contains).hasChildren();
    }

    private static JsonArray requireArray(JsonObject body, String name) {
        JsonElement el = body.get(name);
        if (el == null || !el.isJsonArray()) {
            throw ApiError.badParam("missing required array field: " + name);
        }
        return el.getAsJsonArray();
    }
}
