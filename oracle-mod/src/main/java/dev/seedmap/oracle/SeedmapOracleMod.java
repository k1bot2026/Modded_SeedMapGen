package dev.seedmap.oracle;

import dev.seedmap.oracle.http.OracleHttpServer;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

/**
 * Server entrypoint. Starts the oracle HTTP server once all worlds are live
 * (SERVER_STARTED fires on the server thread, so world/seed access there is safe)
 * and stops it when the server begins shutting down.
 */
public final class SeedmapOracleMod implements DedicatedServerModInitializer {
    public static final String MOD_ID = "seedmap-oracle";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private OracleHttpServer httpServer;

    @Override
    public void onInitializeServer() {
        OracleConfig config = OracleConfig.load(LOGGER);

        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            try {
                httpServer = OracleHttpServer.start(server, config);
            } catch (IOException e) {
                LOGGER.error("Failed to start the oracle HTTP server on 127.0.0.1:{}", config.port(), e);
            }
        });

        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            if (httpServer != null) {
                httpServer.shutdown();
                httpServer = null;
            }
        });
    }
}
