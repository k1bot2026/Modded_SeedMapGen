package dev.seedmap.oracle.world;

import dev.seedmap.oracle.http.ApiError;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerChunkManager;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.world.biome.source.BiomeSource;
import net.minecraft.world.biome.source.util.MultiNoiseUtil;
import net.minecraft.world.gen.chunk.ChunkGenerator;
import net.minecraft.world.gen.chunk.placement.StructurePlacementCalculator;
import net.minecraft.world.gen.noise.NoiseConfig;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-dimension worldgen handles, resolved once and cached. Everything here comes from the
 * live server objects (the oracle rule: never reimplement worldgen). The seeded multi-noise
 * sampler and the structure placement calculator are chunk-load-free query surfaces.
 */
public final class Dimensions {
    /**
     * @param sampler the seeded sampler from the dimension's {@link NoiseConfig}; biome
     *                queries go through {@code biomeSource.getBiome(quartX, quartY, quartZ, sampler)}
     *                and never through {@code World#getBiome} (which loads chunks).
     */
    public record Context(
            String id,
            ServerWorld world,
            ChunkGenerator generator,
            BiomeSource biomeSource,
            NoiseConfig noiseConfig,
            MultiNoiseUtil.MultiNoiseSampler sampler,
            StructurePlacementCalculator calculator,
            long seed
    ) {
    }

    private final ConcurrentHashMap<String, Context> cache = new ConcurrentHashMap<>();

    /** Must be called on the server thread. */
    public Context get(MinecraftServer server, String dim) {
        Context cached = cache.get(dim);
        if (cached != null) {
            return cached;
        }
        for (ServerWorld world : server.getWorlds()) {
            String id = world.getRegistryKey().getValue().toString();
            if (id.equals(dim)) {
                ServerChunkManager chunkManager = world.getChunkManager();
                ChunkGenerator generator = chunkManager.getChunkGenerator();
                NoiseConfig noiseConfig = chunkManager.getNoiseConfig();
                Context context = new Context(
                        id,
                        world,
                        generator,
                        generator.getBiomeSource(),
                        noiseConfig,
                        noiseConfig.getMultiNoiseSampler(),
                        chunkManager.getStructurePlacementCalculator(),
                        world.getSeed());
                cache.put(dim, context);
                return context;
            }
        }
        throw ApiError.unknownDimension(dim);
    }
}
