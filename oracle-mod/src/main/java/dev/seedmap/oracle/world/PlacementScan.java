package dev.seedmap.oracle.world;

import dev.seedmap.oracle.http.ApiError;
import net.minecraft.util.math.ChunkPos;
import net.minecraft.world.gen.chunk.placement.ConcentricRingsStructurePlacement;
import net.minecraft.world.gen.chunk.placement.RandomSpreadStructurePlacement;
import net.minecraft.world.gen.chunk.placement.StructurePlacement;
import net.minecraft.world.gen.chunk.placement.StructurePlacementCalculator;

import java.util.ArrayList;
import java.util.List;

/**
 * Candidate start-chunk enumeration for one {@link StructurePlacement} inside a chunk bbox.
 * Never reimplements placement math: random-spread start chunks come from the game's own
 * {@code getStartChunk}, ring positions from the calculator, and every candidate is gated by
 * the real {@code StructurePlacement#shouldGenerate} (frequency reduction + exclusion zones).
 * Unknown (modded) placement types fall back to a bounded exhaustive shouldGenerate scan.
 */
public final class PlacementScan {
    /** Contract cap for /structures/placed: bbox limited to 512x512 chunks. */
    public static final int MAX_PLACED_CHUNK_SPAN = 512;
    /** Cap for /structures/candidates region enumeration (documented in the mod README). */
    public static final long MAX_CANDIDATE_CHUNK_AREA = 2048L * 2048L;
    /** Cap for the exhaustive fallback used for unknown placement types. */
    public static final long MAX_BRUTE_FORCE_CHUNK_AREA = 512L * 512L;

    private PlacementScan() {
    }

    public static List<ChunkPos> candidateChunks(
            StructurePlacementCalculator calculator,
            StructurePlacement placement,
            int minChunkX, int minChunkZ, int maxChunkX, int maxChunkZ) {
        List<ChunkPos> out = new ArrayList<>();
        if (placement instanceof RandomSpreadStructurePlacement spread && spread.getSpacing() > 0) {
            int spacing = spread.getSpacing();
            long structureSeed = calculator.getStructureSeed();
            int regionMinX = Math.floorDiv(minChunkX, spacing);
            int regionMaxX = Math.floorDiv(maxChunkX, spacing);
            int regionMinZ = Math.floorDiv(minChunkZ, spacing);
            int regionMaxZ = Math.floorDiv(maxChunkZ, spacing);
            for (int regionX = regionMinX; regionX <= regionMaxX; regionX++) {
                for (int regionZ = regionMinZ; regionZ <= regionMaxZ; regionZ++) {
                    // getStartChunk floors its chunk arguments to the region, so any chunk
                    // inside the region selects it; use the region origin chunk.
                    ChunkPos start = spread.getStartChunk(structureSeed, regionX * spacing, regionZ * spacing);
                    if (start.x >= minChunkX && start.x <= maxChunkX
                            && start.z >= minChunkZ && start.z <= maxChunkZ
                            && placement.shouldGenerate(calculator, start.x, start.z)) {
                        out.add(start);
                    }
                }
            }
            return out;
        }
        if (placement instanceof ConcentricRingsStructurePlacement rings) {
            List<ChunkPos> positions = calculator.getPlacementPositions(rings);
            if (positions == null) {
                return List.of();
            }
            for (ChunkPos pos : positions) {
                if (pos.x >= minChunkX && pos.x <= maxChunkX
                        && pos.z >= minChunkZ && pos.z <= maxChunkZ
                        && placement.shouldGenerate(calculator, pos.x, pos.z)) {
                    out.add(pos);
                }
            }
            return out;
        }
        long area = chunkArea(minChunkX, minChunkZ, maxChunkX, maxChunkZ);
        if (area > MAX_BRUTE_FORCE_CHUNK_AREA) {
            throw ApiError.tooLarge(
                    "bbox too large for exhaustive scan of placement type "
                            + placement.getClass().getSimpleName()
                            + " (max " + MAX_BRUTE_FORCE_CHUNK_AREA + " chunks)");
        }
        for (int chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
            for (int chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
                if (placement.shouldGenerate(calculator, chunkX, chunkZ)) {
                    out.add(new ChunkPos(chunkX, chunkZ));
                }
            }
        }
        return out;
    }

    public static long chunkArea(int minChunkX, int minChunkZ, int maxChunkX, int maxChunkZ) {
        return (maxChunkX - (long) minChunkX + 1) * (maxChunkZ - (long) minChunkZ + 1);
    }
}
