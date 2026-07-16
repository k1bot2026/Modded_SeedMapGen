package dev.seedmap.oracle.endpoint;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.datafixers.util.Pair;
import com.sun.net.httpserver.HttpExchange;
import dev.seedmap.oracle.http.ApiError;
import dev.seedmap.oracle.http.HttpJson;
import dev.seedmap.oracle.world.Dimensions;
import dev.seedmap.oracle.world.PlacementScan;
import dev.seedmap.oracle.world.ServerTasks;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.registry.entry.RegistryEntryList;
import net.minecraft.registry.tag.TagKey;
import net.minecraft.structure.StructureSet;
import net.minecraft.structure.StructureStart;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.ChunkPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.biome.Biome;
import net.minecraft.world.gen.chunk.placement.StructurePlacement;
import net.minecraft.world.gen.structure.Structure;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * GET /structures/candidates, GET /structures/placed, GET /locate.
 *
 * Verification levels:
 * - grid: real placement candidate (game's shouldGenerate);
 * - biome_ok: the structure's valid-biome list contains the sampler biome at the candidate
 *   anchor for at least one of the contract's quart-Y probes (block Y -48, 0, 64 — covers
 *   deep/cave/surface structures such as minecraft:ancient_city). A fast prefilter: the
 *   game evaluates the biome at the structure's own generation position/height, which is
 *   only known after start computation — start_ok is the game-accurate check;
 * - start_ok: the vanilla per-start-chunk outcome. Multi-entry sets replicate the vanilla
 *   weighted elimination draw (carver-seeded ChunkRandom over the set's weighted entries,
 *   see PlacementScan#weightedWinner) and only the winning entry — a real StructureStart
 *   computed via Structure#createStructureStart with children — is reported; at grid and
 *   biome_ok every passing entry of a set is listed.
 */
public final class StructureEndpoints {
    /** The biome_ok probe heights in block Y (contract: pass if ANY probe matches). */
    private static final int[] BIOME_PROBE_BLOCK_YS = {-48, 0, 64};
    /** The /locate center height (arbitrary; locateStructure only uses the horizontal pos). */
    private static final int LOCATE_CENTER_Y = 64;
    /** Vanilla /locate search radius in chunks (LocateCommand.LOCATE_STRUCTURE_RADIUS). */
    private static final int LOCATE_RADIUS_CHUNKS = 100;

    private enum Level {
        GRID("grid"),
        BIOME_OK("biome_ok"),
        START_OK("start_ok");

        final String name;

        Level(String name) {
            this.name = name;
        }

        static Level parse(String value) {
            for (Level level : values()) {
                if (level.name.equals(value)) {
                    return level;
                }
            }
            throw ApiError.badParam("level must be one of grid, biome_ok, start_ok");
        }
    }

    private final MinecraftServer server;
    private final Dimensions dimensions;

    public StructureEndpoints(MinecraftServer server, Dimensions dimensions) {
        this.server = server;
        this.dimensions = dimensions;
    }

    // ------------------------------------------------------------------ candidates

    public void handleCandidates(HttpExchange exchange) throws IOException {
        Map<String, String> params = HttpJson.queryParams(exchange);
        String dim = HttpJson.requireString(params, "dim");
        String setId = HttpJson.requireString(params, "structureSet");
        int minX = HttpJson.requireInt(params, "minX");
        int minZ = HttpJson.requireInt(params, "minZ");
        int maxX = HttpJson.requireInt(params, "maxX");
        int maxZ = HttpJson.requireInt(params, "maxZ");
        validateBbox(minX, minZ, maxX, maxZ);

        int minChunkX = minX >> 4;
        int minChunkZ = minZ >> 4;
        int maxChunkX = maxX >> 4;
        int maxChunkZ = maxZ >> 4;
        if (PlacementScan.chunkArea(minChunkX, minChunkZ, maxChunkX, maxChunkZ) > PlacementScan.MAX_CANDIDATE_CHUNK_AREA) {
            throw ApiError.tooLarge("bbox exceeds " + PlacementScan.MAX_CANDIDATE_CHUNK_AREA + " chunks");
        }

        List<ChunkPos> candidates = ServerTasks.onServerThread(server, () -> {
            Dimensions.Context ctx = dimensions.get(server, dim);
            Registry<StructureSet> setRegistry = server.getRegistryManager().get(RegistryKeys.STRUCTURE_SET);
            Identifier id = Identifier.tryParse(setId);
            Optional<RegistryEntry.Reference<StructureSet>> setEntry =
                    id == null ? Optional.empty() : setRegistry.getEntry(id);
            if (setEntry.isEmpty()) {
                throw ApiError.unknownStructureSet(setId);
            }
            StructureSet set = setEntry.get().value();
            // A set registered but not active in this dimension (biome-filtered out of the
            // calculator) has no candidates here.
            boolean activeInDimension = ctx.calculator().getStructureSets().stream()
                    .anyMatch(entry -> entry.value() == set);
            if (!activeInDimension) {
                return List.<ChunkPos>of();
            }
            return PlacementScan.candidateChunks(
                    ctx.calculator(), set.placement(), minChunkX, minChunkZ, maxChunkX, maxChunkZ);
        });

        JsonObject body = new JsonObject();
        body.addProperty("dim", dim);
        body.addProperty("structureSet", setId);
        JsonArray list = new JsonArray();
        for (ChunkPos pos : candidates) {
            JsonObject candidate = new JsonObject();
            candidate.addProperty("chunkX", pos.x);
            candidate.addProperty("chunkZ", pos.z);
            candidate.addProperty("blockX", pos.getStartX());
            candidate.addProperty("blockZ", pos.getStartZ());
            list.add(candidate);
        }
        body.add("candidates", list);
        HttpJson.sendJson(exchange, 200, body);
    }

    // ------------------------------------------------------------------ placed

    public void handlePlaced(HttpExchange exchange) throws IOException {
        Map<String, String> params = HttpJson.queryParams(exchange);
        String dim = HttpJson.requireString(params, "dim");
        int minX = HttpJson.requireInt(params, "minX");
        int minZ = HttpJson.requireInt(params, "minZ");
        int maxX = HttpJson.requireInt(params, "maxX");
        int maxZ = HttpJson.requireInt(params, "maxZ");
        validateBbox(minX, minZ, maxX, maxZ);
        Level level = Level.parse(params.getOrDefault("level", Level.BIOME_OK.name));
        Set<String> types = parseTypesFilter(params.get("types"));

        int minChunkX = minX >> 4;
        int minChunkZ = minZ >> 4;
        int maxChunkX = maxX >> 4;
        int maxChunkZ = maxZ >> 4;
        if (maxChunkX - minChunkX + 1 > PlacementScan.MAX_PLACED_CHUNK_SPAN
                || maxChunkZ - minChunkZ + 1 > PlacementScan.MAX_PLACED_CHUNK_SPAN) {
            throw ApiError.tooLarge("bbox exceeds " + PlacementScan.MAX_PLACED_CHUNK_SPAN + "x"
                    + PlacementScan.MAX_PLACED_CHUNK_SPAN + " chunks");
        }

        JsonArray features = ServerTasks.onServerThread(server, () -> {
            Dimensions.Context ctx = dimensions.get(server, dim);
            JsonArray out = new JsonArray();
            for (RegistryEntry<StructureSet> setEntry : ctx.calculator().getStructureSets()) {
                StructureSet set = setEntry.value();
                List<StructureSet.WeightedEntry> relevant = new ArrayList<>();
                for (StructureSet.WeightedEntry weighted : set.structures()) {
                    if (types == null || types.contains(weighted.structure().getIdAsString())) {
                        relevant.add(weighted);
                    }
                }
                if (level == Level.BIOME_OK) {
                    // Cheap short-circuit: a structure whose valid-biome list shares nothing
                    // with the dimension's biome source can never pass a probe.
                    relevant.removeIf(weighted -> !canOccurInDimension(ctx, weighted.structure().value()));
                }
                if (relevant.isEmpty()) {
                    continue;
                }
                StructurePlacement placement = set.placement();
                List<ChunkPos> candidates = PlacementScan.candidateChunks(
                        ctx.calculator(), placement, minChunkX, minChunkZ, maxChunkX, maxChunkZ);
                String setId = setEntry.getIdAsString();
                for (ChunkPos chunkPos : candidates) {
                    BlockPos anchor = placement.getLocatePos(chunkPos);
                    if (level == Level.START_OK) {
                        // Vanilla places at most one structure of a set per start chunk;
                        // the draw runs over the full set, the types filter only gates output.
                        StructureSet.WeightedEntry winner = PlacementScan.weightedWinner(
                                set, ctx.calculator().getStructureSeed(), chunkPos,
                                weighted -> computesRealStart(ctx, weighted.structure().value(), chunkPos));
                        if (winner != null
                                && (types == null || types.contains(winner.structure().getIdAsString()))) {
                            out.add(feature(winner, setId, anchor, chunkPos, level));
                        }
                        continue;
                    }
                    List<RegistryEntry<Biome>> probes =
                            level == Level.BIOME_OK ? probeBiomes(ctx, anchor) : null;
                    for (StructureSet.WeightedEntry weighted : relevant) {
                        if (level == Level.BIOME_OK
                                && !anyProbeValid(weighted.structure().value(), probes)) {
                            continue;
                        }
                        out.add(feature(weighted, setId, anchor, chunkPos, level));
                    }
                }
            }
            return out;
        });

        JsonObject body = new JsonObject();
        body.addProperty("dim", dim);
        body.add("features", features);
        HttpJson.sendJson(exchange, 200, body);
    }

    private static JsonObject feature(StructureSet.WeightedEntry entry, String setId,
                                      BlockPos anchor, ChunkPos chunkPos, Level level) {
        JsonObject feature = new JsonObject();
        feature.addProperty("id", entry.structure().getIdAsString());
        feature.addProperty("structureSet", setId);
        feature.addProperty("x", anchor.getX());
        feature.addProperty("z", anchor.getZ());
        feature.addProperty("chunkX", chunkPos.x);
        feature.addProperty("chunkZ", chunkPos.z);
        feature.addProperty("level", level.name);
        return feature;
    }

    /** Sampler biomes at the anchor, one per contract probe height (block Y -48, 0, 64). */
    private static List<RegistryEntry<Biome>> probeBiomes(Dimensions.Context ctx, BlockPos anchor) {
        List<RegistryEntry<Biome>> biomes = new ArrayList<>(BIOME_PROBE_BLOCK_YS.length);
        for (int blockY : BIOME_PROBE_BLOCK_YS) {
            biomes.add(ctx.biomeSource().getBiome(
                    anchor.getX() >> 2, blockY >> 2, anchor.getZ() >> 2, ctx.sampler()));
        }
        return biomes;
    }

    private static boolean anyProbeValid(Structure structure, List<RegistryEntry<Biome>> probes) {
        RegistryEntryList<Biome> validBiomes = structure.getValidBiomes();
        for (RegistryEntry<Biome> biome : probes) {
            if (validBiomes.contains(biome)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Vanilla's own dimension prefilter pattern (StructurePlacementCalculator#hasValidBiome):
     * a structure can only ever place where its valid-biome list intersects the biome
     * source's possible biomes.
     */
    private static boolean canOccurInDimension(Dimensions.Context ctx, Structure structure) {
        return structure.getValidBiomes().stream().anyMatch(ctx.biomeSource().getBiomes()::contains);
    }

    /**
     * Game-accurate start check: mirrors ChunkGenerator#trySetStructureStart — the same
     * registries, generator, noise config, template manager, the calculator's structure seed,
     * references=0 for an ungenerated chunk, and the structure's valid-biome predicate.
     */
    private boolean computesRealStart(Dimensions.Context ctx, Structure structure, ChunkPos chunkPos) {
        RegistryEntryList<Biome> validBiomes = structure.getValidBiomes();
        StructureStart start = structure.createStructureStart(
                server.getRegistryManager(),
                ctx.generator(),
                ctx.biomeSource(),
                ctx.noiseConfig(),
                server.getStructureTemplateManager(),
                ctx.calculator().getStructureSeed(),
                chunkPos,
                0,
                ctx.world(),
                validBiomes::contains);
        return start.hasChildren();
    }

    // ------------------------------------------------------------------ locate

    public void handleLocate(HttpExchange exchange) throws IOException {
        Map<String, String> params = HttpJson.queryParams(exchange);
        String dim = HttpJson.requireString(params, "dim");
        int x = HttpJson.requireInt(params, "x");
        int z = HttpJson.requireInt(params, "z");
        String structureParam = HttpJson.requireString(params, "structure");

        JsonObject body = ServerTasks.onServerThread(server, () -> {
            Dimensions.Context ctx = dimensions.get(server, dim);
            Registry<Structure> registry = server.getRegistryManager().get(RegistryKeys.STRUCTURE);
            RegistryEntryList<Structure> targets = resolveTargets(registry, structureParam);
            BlockPos center = new BlockPos(x, LOCATE_CENTER_Y, z);
            // Same code path as the vanilla /locate command: radius 100 chunks, not skipping
            // referenced structures. By-design side effect (see the contract's read-only
            // guarantee): the vanilla path may compute structure starts and persist
            // STRUCTURE_STARTS-stage proto-chunks in the throwaway world.
            Pair<BlockPos, RegistryEntry<Structure>> result = ctx.generator().locateStructure(
                    ctx.world(), targets, center, LOCATE_RADIUS_CHUNKS, false);
            if (result == null) {
                throw ApiError.notFound("no " + structureParam + " within "
                        + LOCATE_RADIUS_CHUNKS + " chunks of (" + x + ", " + z + ")");
            }
            BlockPos pos = result.getFirst();
            double dx = pos.getX() - (double) x;
            double dz = pos.getZ() - (double) z;
            JsonObject found = new JsonObject();
            found.addProperty("structure", result.getSecond().getIdAsString());
            found.addProperty("x", pos.getX());
            found.addProperty("z", pos.getZ());
            found.addProperty("distance", Math.sqrt(dx * dx + dz * dz));
            return found;
        });

        HttpJson.sendJson(exchange, 200, body);
    }

    private static RegistryEntryList<Structure> resolveTargets(Registry<Structure> registry, String structureParam) {
        if (structureParam.startsWith("#")) {
            Identifier tagId = Identifier.tryParse(structureParam.substring(1));
            if (tagId == null) {
                throw ApiError.badParam("invalid structure tag id: " + structureParam);
            }
            return registry.getEntryList(TagKey.of(RegistryKeys.STRUCTURE, tagId))
                    .map(named -> (RegistryEntryList<Structure>) named)
                    .orElseThrow(() -> ApiError.unknownStructure(structureParam));
        }
        Identifier id = Identifier.tryParse(structureParam);
        Optional<RegistryEntry.Reference<Structure>> entry = id == null ? Optional.empty() : registry.getEntry(id);
        if (entry.isEmpty()) {
            throw ApiError.unknownStructure(structureParam);
        }
        return RegistryEntryList.of(entry.get());
    }

    private static void validateBbox(int minX, int minZ, int maxX, int maxZ) {
        if (minX > maxX || minZ > maxZ) {
            throw ApiError.badParam("bbox min must not exceed max");
        }
    }

    /** Comma-separated structure ids, or null for "no filter". */
    private static Set<String> parseTypesFilter(String typesParam) {
        if (typesParam == null || typesParam.isEmpty()) {
            return null;
        }
        Set<String> types = new HashSet<>();
        for (String type : typesParam.split(",")) {
            types.add(type.trim());
        }
        return types;
    }
}
