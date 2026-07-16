package dev.seedmap.oracle.http;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.seedmap.oracle.OracleConfig;
import dev.seedmap.oracle.SeedmapOracleMod;
import dev.seedmap.oracle.endpoint.BiomeEndpoints;
import dev.seedmap.oracle.endpoint.MetaEndpoint;
import dev.seedmap.oracle.endpoint.RegistryEndpoints;
import dev.seedmap.oracle.endpoint.SeedVerifyEndpoint;
import dev.seedmap.oracle.endpoint.StructureEndpoints;
import dev.seedmap.oracle.endpoint.TileEndpoint;
import dev.seedmap.oracle.world.BiomeColors;
import dev.seedmap.oracle.world.Dimensions;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The embedded oracle HTTP server: JDK com.sun.net.httpserver bound to 127.0.0.1 only.
 * HTTP workers never touch Minecraft state directly — every endpoint hops to the server
 * thread via {@link dev.seedmap.oracle.world.ServerTasks}.
 */
public final class OracleHttpServer {
    private static final Logger LOGGER = SeedmapOracleMod.LOGGER;
    private static final String[] ENDPOINTS = {
            "GET  /meta",
            "GET  /biome?dim=&x=&y=&z=",
            "POST /biomes/grid",
            "GET  /tiles/{dim}/{y}/{z}/{tx}/{tz}.png",
            "GET  /structures/candidates?dim=&structureSet=&minX=&minZ=&maxX=&maxZ=",
            "GET  /structures/placed?dim=&minX=&minZ=&maxX=&maxZ=[&types=][&level=]",
            "GET  /locate?dim=&x=&z=&structure=",
            "GET  /registry/structures",
            "GET  /registry/biomes",
            "POST /seed/verify",
    };

    private final HttpServer httpServer;
    private final ExecutorService workers;
    private final MetaEndpoint meta;
    private final BiomeEndpoints biomes;
    private final TileEndpoint tiles;
    private final StructureEndpoints structures;
    private final RegistryEndpoints registries;
    private final SeedVerifyEndpoint seedVerify;

    private OracleHttpServer(HttpServer httpServer, ExecutorService workers,
                             MinecraftServer server, OracleConfig config, String seedString) {
        this.httpServer = httpServer;
        this.workers = workers;
        Dimensions dimensions = new Dimensions();
        BiomeColors colors = new BiomeColors();
        this.meta = new MetaEndpoint(server, config);
        this.biomes = new BiomeEndpoints(server, dimensions);
        this.tiles = new TileEndpoint(server, config, seedString, dimensions, colors);
        this.structures = new StructureEndpoints(server, dimensions);
        this.registries = new RegistryEndpoints(server, dimensions, colors);
        this.seedVerify = new SeedVerifyEndpoint(server, dimensions);
    }

    /**
     * Must be called on the server thread with all worlds live (SERVER_STARTED); the world
     * seed for the tile cache path is captured here.
     */
    public static OracleHttpServer start(MinecraftServer server, OracleConfig config) throws IOException {
        String seedString = String.valueOf(server.getOverworld().getSeed());

        AtomicInteger counter = new AtomicInteger();
        ExecutorService workers = Executors.newFixedThreadPool(4, runnable -> {
            Thread thread = new Thread(runnable, "seedmap-oracle-http-" + counter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        });

        HttpServer httpServer = HttpServer.create(
                new InetSocketAddress(InetAddress.getLoopbackAddress(), config.port()), 0);
        httpServer.setExecutor(workers);
        OracleHttpServer oracle = new OracleHttpServer(httpServer, workers, server, config, seedString);
        httpServer.createContext("/", oracle::dispatch);
        httpServer.start();

        LOGGER.info("Seedmap oracle listening on http://127.0.0.1:{}", config.port());
        for (String endpoint : ENDPOINTS) {
            LOGGER.info("  {}", endpoint);
        }
        return oracle;
    }

    public void shutdown() {
        LOGGER.info("Stopping the seedmap oracle HTTP server");
        httpServer.stop(0);
        workers.shutdownNow();
    }

    private void dispatch(HttpExchange exchange) throws IOException {
        long startNanos = System.nanoTime();
        String method = exchange.getRequestMethod();
        String path = exchange.getRequestURI().getPath();
        try {
            if ("OPTIONS".equalsIgnoreCase(method)) {
                Headers headers = exchange.getResponseHeaders();
                HttpJson.applyCors(headers);
                headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                headers.set("Access-Control-Allow-Headers", "Content-Type");
                exchange.setAttribute(HttpJson.STATUS_ATTRIBUTE, 204);
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            route(exchange, method, path);
        } catch (ApiError error) {
            HttpJson.sendError(exchange, error);
        } catch (Exception e) {
            LOGGER.error("Unhandled error serving {} {}", method, path, e);
            HttpJson.sendError(exchange, ApiError.internal("unexpected error: " + e.getMessage()));
        } finally {
            Object status = exchange.getAttribute(HttpJson.STATUS_ATTRIBUTE);
            long millis = (System.nanoTime() - startNanos) / 1_000_000L;
            LOGGER.info("{} {} -> {} ({} ms)", method, path, status == null ? "?" : status, millis);
            exchange.close();
        }
    }

    private void route(HttpExchange exchange, String method, String path) throws IOException {
        boolean get = "GET".equalsIgnoreCase(method);
        boolean post = "POST".equalsIgnoreCase(method);
        switch (path) {
            case "/meta" -> requireMethod(get, () -> meta.handle(exchange));
            case "/biome" -> requireMethod(get, () -> biomes.handleBiome(exchange));
            case "/biomes/grid" -> requireMethod(post, () -> biomes.handleGrid(exchange));
            case "/structures/candidates" -> requireMethod(get, () -> structures.handleCandidates(exchange));
            case "/structures/placed" -> requireMethod(get, () -> structures.handlePlaced(exchange));
            case "/locate" -> requireMethod(get, () -> structures.handleLocate(exchange));
            case "/registry/structures" -> requireMethod(get, () -> registries.handleStructures(exchange));
            case "/registry/biomes" -> requireMethod(get, () -> registries.handleBiomes(exchange));
            case "/seed/verify" -> requireMethod(post, () -> seedVerify.handle(exchange));
            default -> {
                if (path.startsWith("/tiles/")) {
                    requireMethod(get, () -> tiles.handle(exchange));
                } else {
                    throw ApiError.notFound("no such endpoint: " + path);
                }
            }
        }
    }

    @FunctionalInterface
    private interface Handler {
        void run() throws IOException;
    }

    private static void requireMethod(boolean methodMatches, Handler handler) throws IOException {
        if (!methodMatches) {
            throw ApiError.badParam("method not allowed for this endpoint");
        }
        handler.run();
    }
}
