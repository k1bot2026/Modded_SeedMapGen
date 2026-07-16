package dev.seedmap.oracle.world;

import dev.seedmap.oracle.http.ApiError;
import net.minecraft.server.MinecraftServer;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;

/**
 * All registry/world/generator access happens on the server thread: HTTP workers submit a
 * value-producing task via {@code MinecraftServer#submit(Supplier)} and await the future
 * with a 30 s timeout. {@link ApiError} thrown inside the task propagates to the caller.
 */
public final class ServerTasks {
    private static final long TIMEOUT_SECONDS = 30;

    private ServerTasks() {
    }

    public static <T> T onServerThread(MinecraftServer server, Supplier<T> task) {
        try {
            return server.submit(task).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            throw ApiError.internal("server-thread task timed out after " + TIMEOUT_SECONDS + " s");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ApiError.internal("interrupted while waiting for the server thread");
        } catch (ExecutionException e) {
            if (e.getCause() instanceof ApiError apiError) {
                throw apiError;
            }
            throw ApiError.internal("server-thread task failed: " + e.getCause());
        }
    }
}
