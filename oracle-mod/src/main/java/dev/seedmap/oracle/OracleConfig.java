package dev.seedmap.oracle;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Oracle configuration, read from {@code config/seedmap-oracle.json} in the server
 * directory (written by the provisioner before launch). A missing or malformed file
 * falls back to the contract defaults: port 8765, packName "unknown", fingerprint
 * "unfingerprinted", cacheDir {@code seedmap-cache/} inside the server dir.
 */
public record OracleConfig(
        int port,
        String packName,
        String packVersion,
        String packFingerprint,
        Path cacheDir,
        JsonArray overlayDiff
) {
    public static final String FILE_NAME = "seedmap-oracle.json";

    public static OracleConfig load(Logger logger) {
        Path gameDir = FabricLoader.getInstance().getGameDir();
        Path file = FabricLoader.getInstance().getConfigDir().resolve(FILE_NAME);

        int port = 8765;
        String packName = "unknown";
        String packVersion = "unknown";
        String packFingerprint = "unfingerprinted";
        Path cacheDir = gameDir.resolve("seedmap-cache");
        JsonArray overlayDiff = new JsonArray();

        if (Files.isRegularFile(file)) {
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
                if (root.has("port")) {
                    port = root.get("port").getAsInt();
                }
                if (root.has("packName")) {
                    packName = root.get("packName").getAsString();
                }
                if (root.has("packVersion")) {
                    packVersion = root.get("packVersion").getAsString();
                }
                if (root.has("packFingerprint")) {
                    packFingerprint = root.get("packFingerprint").getAsString();
                }
                if (root.has("cacheDir")) {
                    // Absolute per contract; a relative path is resolved against the server dir.
                    cacheDir = gameDir.resolve(root.get("cacheDir").getAsString());
                }
                if (root.has("overlayDiff") && root.get("overlayDiff").isJsonArray()) {
                    overlayDiff = root.getAsJsonArray("overlayDiff");
                }
                logger.info("Loaded oracle config from {}", file);
            } catch (IOException | RuntimeException e) {
                logger.warn("Could not read {} ({}); using defaults", file, e.toString());
            }
        } else {
            logger.info("No {} found; using defaults (port {})", FILE_NAME, port);
        }

        if (port <= 0 || port > 65535) {
            logger.warn("Configured port {} is out of range; falling back to 8765", port);
            port = 8765;
        }

        return new OracleConfig(port, packName, packVersion, packFingerprint, cacheDir, overlayDiff);
    }
}
