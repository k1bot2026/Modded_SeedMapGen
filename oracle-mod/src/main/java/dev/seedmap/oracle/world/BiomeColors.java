package dev.seedmap.oracle.world;

import net.minecraft.world.biome.Biome;
import net.minecraft.world.biome.BiomeEffects;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Runtime biome palette, contract order: grass color if the biome defines one, else foliage
 * color, else water color, else a stable FNV-1a hash of the biome id mapped to HSL. Since
 * water color is a required biome field the hash path only triggers defensively (null biome).
 * The same color is served by tiles and by /registry/biomes so the legend always matches.
 */
public final class BiomeColors {
    private final ConcurrentHashMap<String, Integer> cache = new ConcurrentHashMap<>();

    /** Returns an opaque 0xRRGGBB color. */
    public int colorOf(String biomeId, Biome biome) {
        Integer cached = cache.get(biomeId);
        if (cached != null) {
            return cached;
        }
        int color = compute(biomeId, biome);
        cache.put(biomeId, color);
        return color;
    }

    private static int compute(String biomeId, Biome biome) {
        if (biome != null) {
            BiomeEffects effects = biome.getEffects();
            Optional<Integer> grass = effects.getGrassColor();
            if (grass.isPresent()) {
                return grass.get() & 0xFFFFFF;
            }
            Optional<Integer> foliage = effects.getFoliageColor();
            if (foliage.isPresent()) {
                return foliage.get() & 0xFFFFFF;
            }
            return effects.getWaterColor() & 0xFFFFFF;
        }
        return hashColor(biomeId);
    }

    public static String hex(int rgb) {
        return String.format("#%06x", rgb & 0xFFFFFF);
    }

    /** Stable FNV-1a (32-bit) over the biome id, mapped to a mid-saturation HSL color. */
    static int hashColor(String id) {
        int hash = 0x811C9DC5;
        for (int i = 0; i < id.length(); i++) {
            hash ^= id.charAt(i);
            hash *= 0x01000193;
        }
        float hue = Math.floorMod(hash, 360) / 360.0f;
        return hslToRgb(hue, 0.55f, 0.5f);
    }

    private static int hslToRgb(float h, float s, float l) {
        float q = l < 0.5f ? l * (1 + s) : l + s - l * s;
        float p = 2 * l - q;
        int r = Math.round(hueToChannel(p, q, h + 1.0f / 3.0f) * 255);
        int g = Math.round(hueToChannel(p, q, h) * 255);
        int b = Math.round(hueToChannel(p, q, h - 1.0f / 3.0f) * 255);
        return (r << 16) | (g << 8) | b;
    }

    private static float hueToChannel(float p, float q, float t) {
        if (t < 0) {
            t += 1;
        }
        if (t > 1) {
            t -= 1;
        }
        if (t < 1.0f / 6.0f) {
            return p + (q - p) * 6 * t;
        }
        if (t < 1.0f / 2.0f) {
            return q;
        }
        if (t < 2.0f / 3.0f) {
            return p + (q - p) * (2.0f / 3.0f - t) * 6;
        }
        return p;
    }
}
