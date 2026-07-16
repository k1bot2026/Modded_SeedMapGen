package dev.seedmap.oracle.endpoint;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import dev.seedmap.oracle.http.ApiError;
import dev.seedmap.oracle.http.HttpJson;
import dev.seedmap.oracle.world.Dimensions;
import dev.seedmap.oracle.world.ServerTasks;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.biome.Biome;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * GET /biome and POST /biomes/grid. Predicted biomes via the dimension's BiomeSource with
 * the seeded multi-noise sampler at quart coordinates (block >> 2) — never World#getBiome.
 */
public final class BiomeEndpoints {
    /** Contract cap: w*h at most 262144 (512x512). */
    private static final int MAX_GRID_SAMPLES = 262144;

    private final MinecraftServer server;
    private final Dimensions dimensions;

    public BiomeEndpoints(MinecraftServer server, Dimensions dimensions) {
        this.server = server;
        this.dimensions = dimensions;
    }

    public void handleBiome(HttpExchange exchange) throws IOException {
        Map<String, String> params = HttpJson.queryParams(exchange);
        String dim = HttpJson.requireString(params, "dim");
        int x = HttpJson.requireInt(params, "x");
        int y = HttpJson.requireInt(params, "y");
        int z = HttpJson.requireInt(params, "z");

        String biomeId = ServerTasks.onServerThread(server, () -> {
            Dimensions.Context ctx = dimensions.get(server, dim);
            RegistryEntry<Biome> biome = ctx.biomeSource().getBiome(x >> 2, y >> 2, z >> 2, ctx.sampler());
            return biome.getIdAsString();
        });

        JsonObject body = new JsonObject();
        body.addProperty("dim", dim);
        body.addProperty("x", x);
        body.addProperty("y", y);
        body.addProperty("z", z);
        body.addProperty("biome", biomeId);
        HttpJson.sendJson(exchange, 200, body);
    }

    private record GridResult(List<String> palette, int[] data) {
    }

    public void handleGrid(HttpExchange exchange) throws IOException {
        JsonObject request = HttpJson.readJsonBody(exchange);
        String dim = HttpJson.requireString(request, "dim");
        int y = HttpJson.requireInt(request, "y");
        int minX = HttpJson.requireInt(request, "minX");
        int minZ = HttpJson.requireInt(request, "minZ");
        int step = HttpJson.requireInt(request, "step");
        int w = HttpJson.requireInt(request, "w");
        int h = HttpJson.requireInt(request, "h");
        if (step < 1) {
            throw ApiError.badParam("step must be >= 1");
        }
        if (w < 1 || h < 1) {
            throw ApiError.badParam("w and h must be >= 1");
        }
        if ((long) w * h > MAX_GRID_SAMPLES) {
            throw ApiError.tooLarge("w*h exceeds " + MAX_GRID_SAMPLES);
        }

        // The whole grid is sampled in one server-thread task (safe path: the sampler is
        // only ever touched on the server thread).
        GridResult result = ServerTasks.onServerThread(server, () -> {
            Dimensions.Context ctx = dimensions.get(server, dim);
            int quartY = y >> 2;
            List<String> palette = new ArrayList<>();
            Map<RegistryEntry<Biome>, Integer> indexByEntry = new HashMap<>();
            int[] data = new int[w * h];
            for (int row = 0; row < h; row++) {
                int blockZ = minZ + row * step;
                for (int col = 0; col < w; col++) {
                    int blockX = minX + col * step;
                    RegistryEntry<Biome> entry =
                            ctx.biomeSource().getBiome(blockX >> 2, quartY, blockZ >> 2, ctx.sampler());
                    Integer index = indexByEntry.get(entry);
                    if (index == null) {
                        index = palette.size();
                        palette.add(entry.getIdAsString());
                        indexByEntry.put(entry, index);
                    }
                    data[row * w + col] = index;
                }
            }
            return new GridResult(palette, data);
        });

        JsonObject body = new JsonObject();
        body.addProperty("dim", dim);
        body.addProperty("y", y);
        body.addProperty("minX", minX);
        body.addProperty("minZ", minZ);
        body.addProperty("step", step);
        body.addProperty("w", w);
        body.addProperty("h", h);
        JsonArray palette = new JsonArray();
        for (String id : result.palette()) {
            palette.add(id);
        }
        body.add("palette", palette);
        JsonArray data = new JsonArray();
        for (int index : result.data()) {
            data.add(index);
        }
        body.add("data", data);
        HttpJson.sendJson(exchange, 200, body);
    }
}
