package dev.seedmap.oracle.endpoint;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import dev.seedmap.oracle.OracleConfig;
import dev.seedmap.oracle.SeedmapOracleMod;
import dev.seedmap.oracle.http.HttpJson;
import dev.seedmap.oracle.world.ServerTasks;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.SharedConstants;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** GET /meta */
public final class MetaEndpoint {
    private final MinecraftServer server;
    private final OracleConfig config;

    public MetaEndpoint(MinecraftServer server, OracleConfig config) {
        this.server = server;
        this.config = config;
    }

    public void handle(HttpExchange exchange) throws IOException {
        JsonObject meta = ServerTasks.onServerThread(server, this::gather);
        HttpJson.sendJson(exchange, 200, meta);
    }

    private JsonObject gather() {
        JsonObject meta = new JsonObject();
        meta.addProperty("mcVersion", SharedConstants.getGameVersion().getName());
        meta.addProperty("loaderVersion", modVersion("fabricloader"));
        meta.addProperty("oracleModVersion", modVersion(SeedmapOracleMod.MOD_ID));
        // Seeds are JSON strings, never numbers: 64-bit longs lose precision as JS numbers.
        meta.addProperty("seed", String.valueOf(server.getOverworld().getSeed()));
        meta.addProperty("packName", config.packName());
        meta.addProperty("packVersion", config.packVersion());
        meta.addProperty("packFingerprint", config.packFingerprint());
        meta.add("overlayDiff", config.overlayDiff().deepCopy());

        JsonArray dimensions = new JsonArray();
        for (ServerWorld world : server.getWorlds()) {
            dimensions.add(world.getRegistryKey().getValue().toString());
        }
        meta.add("dimensions", dimensions);

        List<ModContainer> mods = new ArrayList<>(FabricLoader.getInstance().getAllMods());
        mods.sort(Comparator.comparing(mod -> mod.getMetadata().getId()));
        JsonArray modList = new JsonArray();
        for (ModContainer mod : mods) {
            JsonObject entry = new JsonObject();
            entry.addProperty("id", mod.getMetadata().getId());
            entry.addProperty("version", mod.getMetadata().getVersion().getFriendlyString());
            entry.addProperty("name", mod.getMetadata().getName());
            modList.add(entry);
        }
        meta.add("mods", modList);
        return meta;
    }

    private static String modVersion(String modId) {
        return FabricLoader.getInstance().getModContainer(modId)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }
}
