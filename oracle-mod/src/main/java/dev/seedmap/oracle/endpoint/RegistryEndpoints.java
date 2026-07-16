package dev.seedmap.oracle.endpoint;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import dev.seedmap.oracle.http.HttpJson;
import dev.seedmap.oracle.world.BiomeColors;
import dev.seedmap.oracle.world.Dimensions;
import dev.seedmap.oracle.world.ServerTasks;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.structure.StructureSet;
import net.minecraft.world.biome.Biome;
import net.minecraft.world.gen.structure.Structure;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/** GET /registry/structures and GET /registry/biomes. */
public final class RegistryEndpoints {
    private final MinecraftServer server;
    private final Dimensions dimensions;
    private final BiomeColors colors;

    public RegistryEndpoints(MinecraftServer server, Dimensions dimensions, BiomeColors colors) {
        this.server = server;
        this.dimensions = dimensions;
        this.colors = colors;
    }

    public void handleStructures(HttpExchange exchange) throws IOException {
        JsonArray structures = ServerTasks.onServerThread(server, () -> {
            Registry<Structure> structureRegistry = server.getRegistryManager().get(RegistryKeys.STRUCTURE);
            Registry<StructureSet> setRegistry = server.getRegistryManager().get(RegistryKeys.STRUCTURE_SET);

            // Reverse index: structure value -> every structure set id referencing it.
            Map<Structure, Set<String>> setsByStructure = new HashMap<>();
            setRegistry.streamEntries().forEach(setRef -> {
                String setId = setRef.registryKey().getValue().toString();
                for (StructureSet.WeightedEntry weighted : setRef.value().structures()) {
                    setsByStructure
                            .computeIfAbsent(weighted.structure().value(), k -> new TreeSet<>())
                            .add(setId);
                }
            });

            // Which dimensions have which sets active (the calculator pre-filters sets whose
            // biomes cannot occur in the dimension's biome source).
            Map<String, Set<String>> dimensionsBySet = new TreeMap<>();
            for (ServerWorld world : server.getWorlds()) {
                String dimId = world.getRegistryKey().getValue().toString();
                Dimensions.Context ctx = dimensions.get(server, dimId);
                for (RegistryEntry<StructureSet> setEntry : ctx.calculator().getStructureSets()) {
                    dimensionsBySet
                            .computeIfAbsent(setEntry.getIdAsString(), k -> new TreeSet<>())
                            .add(dimId);
                }
            }

            Map<String, JsonObject> rows = new TreeMap<>();
            structureRegistry.streamEntries().forEach(structureRef -> {
                String id = structureRef.registryKey().getValue().toString();
                JsonObject row = new JsonObject();
                row.addProperty("id", id);
                row.addProperty("namespace", structureRef.registryKey().getValue().getNamespace());
                JsonArray sets = new JsonArray();
                Set<String> dims = new LinkedHashSet<>();
                for (String setId : setsByStructure.getOrDefault(structureRef.value(), Set.of())) {
                    sets.add(setId);
                    dims.addAll(dimensionsBySet.getOrDefault(setId, Set.of()));
                }
                row.add("sets", sets);
                JsonArray dimList = new JsonArray();
                for (String dim : new TreeSet<>(dims)) {
                    dimList.add(dim);
                }
                row.add("dimensions", dimList);
                rows.put(id, row);
            });

            JsonArray out = new JsonArray();
            rows.values().forEach(out::add);
            return out;
        });

        JsonObject body = new JsonObject();
        body.add("structures", structures);
        HttpJson.sendJson(exchange, 200, body);
    }

    public void handleBiomes(HttpExchange exchange) throws IOException {
        JsonArray biomes = ServerTasks.onServerThread(server, () -> {
            Registry<Biome> registry = server.getRegistryManager().get(RegistryKeys.BIOME);
            List<JsonObject> rows = new ArrayList<>();
            registry.streamEntries().forEach(ref -> {
                String id = ref.registryKey().getValue().toString();
                JsonObject row = new JsonObject();
                row.addProperty("id", id);
                row.addProperty("namespace", ref.registryKey().getValue().getNamespace());
                row.addProperty("color", BiomeColors.hex(colors.colorOf(id, ref.value())));
                rows.add(row);
            });
            rows.sort((a, b) -> a.get("id").getAsString().compareTo(b.get("id").getAsString()));
            JsonArray out = new JsonArray();
            rows.forEach(out::add);
            return out;
        });

        JsonObject body = new JsonObject();
        body.add("biomes", biomes);
        HttpJson.sendJson(exchange, 200, body);
    }
}
