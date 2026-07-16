package dev.seedmap.oracle.endpoint;

import com.sun.net.httpserver.HttpExchange;
import dev.seedmap.oracle.OracleConfig;
import dev.seedmap.oracle.SeedmapOracleMod;
import dev.seedmap.oracle.http.ApiError;
import dev.seedmap.oracle.http.HttpJson;
import dev.seedmap.oracle.world.BiomeColors;
import dev.seedmap.oracle.world.Dimensions;
import dev.seedmap.oracle.world.ServerTasks;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.biome.Biome;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

/**
 * GET /tiles/{dim}/{y}/{z}/{tx}/{tz}.png — 256x256 biome tiles.
 *
 * Zoom scheme per contract: z=0 is native resolution, 1 px = 4 blocks (one biome quart) so a
 * tile spans 1024x1024 blocks; each zoom-out doubles blocks-per-pixel (1 px = 4*2^z blocks,
 * span 1024*2^z), 0 <= z <= 6. Tile (tx, tz) covers [tx*span, (tx+1)*span) x [tz*span, (tz+1)*span).
 *
 * Disk cache: cacheDir/&lt;fingerprint&gt;/&lt;seed&gt;/tiles/&lt;dim&gt;/&lt;y&gt;/&lt;z&gt;/&lt;tx&gt;/&lt;tz&gt;.png with ':' in
 * path components replaced by '_' (the contract specifies this for the dimension; the same
 * sanitization is applied to the fingerprint because ':' is not legal in Windows paths).
 */
public final class TileEndpoint {
    private static final int TILE_SIZE = 256;
    private static final int MAX_ZOOM = 6;
    /** Reject tiles wholly outside any reachable world coordinate (world border is ~30M blocks). */
    private static final long MAX_BLOCK_COORD = 40_000_000L;

    private final MinecraftServer server;
    private final Dimensions dimensions;
    private final BiomeColors colors;
    private final Path tileRoot;

    public TileEndpoint(MinecraftServer server, OracleConfig config, String seedString,
                        Dimensions dimensions, BiomeColors colors) {
        this.server = server;
        this.dimensions = dimensions;
        this.colors = colors;
        this.tileRoot = config.cacheDir()
                .resolve(sanitize(config.packFingerprint()))
                .resolve(sanitize(seedString))
                .resolve("tiles");
    }

    public void handle(HttpExchange exchange) throws IOException {
        // Path shape: /tiles/{dim}/{y}/{z}/{tx}/{tz}.png — dim keeps its ':' unescaped.
        String path = exchange.getRequestURI().getPath();
        String[] segments = path.split("/");
        if (segments.length != 7 || !segments[6].endsWith(".png")) {
            throw ApiError.badParam("tile path must be /tiles/{dim}/{y}/{z}/{tx}/{tz}.png");
        }
        String dim = segments[2];
        int y = HttpJson.parseInt(segments[3], "y");
        int zoom = HttpJson.parseInt(segments[4], "z");
        int tileX = HttpJson.parseInt(segments[5], "tx");
        int tileZ = HttpJson.parseInt(segments[6].substring(0, segments[6].length() - 4), "tz");
        if (zoom < 0 || zoom > MAX_ZOOM) {
            throw ApiError.badParam("zoom must be within 0.." + MAX_ZOOM);
        }
        long span = 1024L << zoom;
        if (Math.abs(tileX * span) > MAX_BLOCK_COORD || Math.abs(tileZ * span) > MAX_BLOCK_COORD) {
            throw ApiError.badParam("tile is outside the reachable world");
        }

        Path cached = tilePath(dim, y, zoom, tileX, tileZ);
        if (Files.isRegularFile(cached)) {
            HttpJson.sendPng(exchange, Files.readAllBytes(cached));
            return;
        }

        byte[] png = render(dim, y, zoom, tileX, tileZ);
        writeCache(cached, png);
        HttpJson.sendPng(exchange, png);
    }

    private byte[] render(String dim, int y, int zoom, int tileX, int tileZ) throws IOException {
        int blocksPerPixel = 4 << zoom;
        long span = (long) TILE_SIZE * blocksPerPixel;
        long originX = tileX * span;
        long originZ = tileZ * span;
        int quartY = y >> 2;

        // One server-thread batch for the whole tile (the sampler stays server-thread-only);
        // PNG encoding happens back on the HTTP worker.
        int[] pixels = ServerTasks.onServerThread(server, () -> {
            Dimensions.Context ctx = dimensions.get(server, dim);
            Map<RegistryEntry<Biome>, Integer> colorByEntry = new HashMap<>();
            int[] rgb = new int[TILE_SIZE * TILE_SIZE];
            for (int pz = 0; pz < TILE_SIZE; pz++) {
                int quartZ = ((int) (originZ + (long) pz * blocksPerPixel)) >> 2;
                for (int px = 0; px < TILE_SIZE; px++) {
                    int quartX = ((int) (originX + (long) px * blocksPerPixel)) >> 2;
                    RegistryEntry<Biome> entry = ctx.biomeSource().getBiome(quartX, quartY, quartZ, ctx.sampler());
                    Integer color = colorByEntry.get(entry);
                    if (color == null) {
                        color = colors.colorOf(entry.getIdAsString(), entry.value());
                        colorByEntry.put(entry, color);
                    }
                    rgb[pz * TILE_SIZE + px] = color;
                }
            }
            return rgb;
        });

        BufferedImage image = new BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_RGB);
        image.setRGB(0, 0, TILE_SIZE, TILE_SIZE, pixels, 0, TILE_SIZE);
        ByteArrayOutputStream out = new ByteArrayOutputStream(32 * 1024);
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private Path tilePath(String dim, int y, int zoom, int tileX, int tileZ) {
        return tileRoot
                .resolve(sanitize(dim))
                .resolve(Integer.toString(y))
                .resolve(Integer.toString(zoom))
                .resolve(Integer.toString(tileX))
                .resolve(tileZ + ".png");
    }

    private static void writeCache(Path target, byte[] png) {
        try {
            Files.createDirectories(target.getParent());
            Path temp = Files.createTempFile(target.getParent(), "tile-", ".tmp");
            Files.write(temp, png);
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            // A failed cache write must not fail the request; the tile was still rendered.
            SeedmapOracleMod.LOGGER.warn("Failed to cache tile {}: {}", target, e.toString());
        }
    }

    private static String sanitize(String component) {
        return component.replace(':', '_');
    }
}
