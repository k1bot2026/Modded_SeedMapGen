import { describe, expect, it } from "vitest";
import {
  DISPLAY_ZOOM_MAX,
  DISPLAY_ZOOM_MIN,
  MAX_MERCATOR_LAT,
  ORACLE_TILE_SPAN_Z0,
  WORLD_RADIUS_BLOCKS,
  WORLD_SIZE_BLOCKS,
  blockToDisplayTile,
  blockToLngLat,
  blocksPerPixel,
  displayTileToBlockBounds,
  displayTileToOracleTile,
  displayZoomToOracleZ,
  latToMercatorY,
  lngLatToBlock,
  oracleTileSpan,
  oracleTileToDisplayTile,
  oracleZToDisplayZoom,
} from "../src/lib/projection";

describe("zoom mapping", () => {
  it("maps display zoom to oracle z (inverted)", () => {
    expect(displayZoomToOracleZ(10)).toBe(0);
    expect(displayZoomToOracleZ(9)).toBe(1);
    expect(displayZoomToOracleZ(4)).toBe(6);
  });

  it("round-trips display zoom <-> oracle z", () => {
    for (let d = DISPLAY_ZOOM_MIN; d <= DISPLAY_ZOOM_MAX; d++) {
      expect(oracleZToDisplayZoom(displayZoomToOracleZ(d))).toBe(d);
    }
  });

  it("rejects out-of-range and fractional zooms", () => {
    expect(() => displayZoomToOracleZ(3)).toThrow(RangeError);
    expect(() => displayZoomToOracleZ(11)).toThrow(RangeError);
    expect(() => displayZoomToOracleZ(5.5)).toThrow(RangeError);
    expect(() => oracleZToDisplayZoom(-1)).toThrow(RangeError);
    expect(() => oracleZToDisplayZoom(7)).toThrow(RangeError);
  });

  it("tile spans double per oracle zoom level", () => {
    expect(oracleTileSpan(0)).toBe(1024);
    expect(oracleTileSpan(6)).toBe(65536);
    expect(blocksPerPixel(0)).toBe(4);
    expect(blocksPerPixel(6)).toBe(256);
    expect(ORACLE_TILE_SPAN_Z0).toBe(1024);
  });
});

describe("display tile <-> oracle tile (center offset)", () => {
  it("applies the 2^(d-1) center offset at d=10", () => {
    expect(displayTileToOracleTile(10, 512, 512)).toEqual({ z: 0, tx: 0, tz: 0 });
    expect(displayTileToOracleTile(10, 511, 513)).toEqual({ z: 0, tx: -1, tz: 1 });
    expect(displayTileToOracleTile(10, 0, 0)).toEqual({ z: 0, tx: -512, tz: -512 });
    expect(displayTileToOracleTile(10, 1023, 1023)).toEqual({ z: 0, tx: 511, tz: 511 });
  });

  it("applies the offset at the coarsest zoom d=4", () => {
    expect(displayTileToOracleTile(4, 8, 8)).toEqual({ z: 6, tx: 0, tz: 0 });
    expect(displayTileToOracleTile(4, 0, 0)).toEqual({ z: 6, tx: -8, tz: -8 });
    expect(displayTileToOracleTile(4, 15, 15)).toEqual({ z: 6, tx: 7, tz: 7 });
  });

  it("round-trips both directions across all zooms", () => {
    for (let d = DISPLAY_ZOOM_MIN; d <= DISPLAY_ZOOM_MAX; d++) {
      const n = 2 ** d;
      for (const dx of [0, 1, n / 2 - 1, n / 2, n - 1]) {
        for (const dy of [0, n / 2, n - 1]) {
          const oracle = displayTileToOracleTile(d, dx, dy);
          expect(oracleTileToDisplayTile(oracle.z, oracle.tx, oracle.tz)).toEqual({
            d,
            dx,
            dy,
          });
        }
      }
    }
  });

  it("rejects display tiles outside [0, 2^d)", () => {
    expect(() => displayTileToOracleTile(4, -1, 0)).toThrow(RangeError);
    expect(() => displayTileToOracleTile(4, 16, 0)).toThrow(RangeError);
    expect(() => displayTileToOracleTile(10, 0, 1024)).toThrow(RangeError);
  });

  it("rejects oracle tiles outside the display window", () => {
    expect(() => oracleTileToDisplayTile(0, 512, 0)).toThrow(RangeError);
    expect(() => oracleTileToDisplayTile(0, -513, 0)).toThrow(RangeError);
    expect(() => oracleTileToDisplayTile(6, 8, 0)).toThrow(RangeError);
  });
});

describe("display tile <-> blocks", () => {
  it("computes signed block bounds including negative tiles", () => {
    expect(displayTileToBlockBounds(10, 512, 512)).toEqual({
      minX: 0,
      minZ: 0,
      maxX: 1024,
      maxZ: 1024,
    });
    expect(displayTileToBlockBounds(10, 511, 511)).toEqual({
      minX: -1024,
      minZ: -1024,
      maxX: 0,
      maxZ: 0,
    });
    expect(displayTileToBlockBounds(4, 0, 0)).toEqual({
      minX: -WORLD_RADIUS_BLOCKS,
      minZ: -WORLD_RADIUS_BLOCKS,
      maxX: -WORLD_RADIUS_BLOCKS + 65536,
      maxZ: -WORLD_RADIUS_BLOCKS + 65536,
    });
  });

  it("blockToDisplayTile is consistent with tile bounds (negatives included)", () => {
    for (const d of [4, 7, 10]) {
      for (const [x, z] of [
        [0, 0],
        [-1, -1],
        [12345, -6789],
        [-WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS - 1],
      ] as const) {
        const { dx, dy } = blockToDisplayTile(d, x, z);
        const bounds = displayTileToBlockBounds(d, dx, dy);
        expect(x).toBeGreaterThanOrEqual(bounds.minX);
        expect(x).toBeLessThan(bounds.maxX);
        expect(z).toBeGreaterThanOrEqual(bounds.minZ);
        expect(z).toBeLessThan(bounds.maxZ);
      }
    }
  });

  it("block (0,0) and (-1,-1) sit on the four center tiles", () => {
    expect(blockToDisplayTile(10, 0, 0)).toEqual({ d: 10, dx: 512, dy: 512 });
    expect(blockToDisplayTile(10, -1, -1)).toEqual({ d: 10, dx: 511, dy: 511 });
  });
});

describe("block <-> lng/lat", () => {
  it("maps the origin to (0, 0)", () => {
    expect(blockToLngLat(0, 0)).toEqual({ lng: 0, lat: 0 });
  });

  it("maps window edges to the mercator square edges", () => {
    expect(blockToLngLat(-WORLD_RADIUS_BLOCKS, 0).lng).toBe(-180);
    expect(blockToLngLat(WORLD_RADIUS_BLOCKS, 0).lng).toBe(180);
    expect(blockToLngLat(0, -WORLD_RADIUS_BLOCKS).lat).toBeCloseTo(MAX_MERCATOR_LAT, 10);
    expect(blockToLngLat(0, WORLD_RADIUS_BLOCKS).lat).toBeCloseTo(-MAX_MERCATOR_LAT, 10);
  });

  it("north (-Z) is up: negative z gives positive latitude", () => {
    expect(blockToLngLat(0, -1000).lat).toBeGreaterThan(0);
    expect(blockToLngLat(0, 1000).lat).toBeLessThan(0);
  });

  it("round-trips block -> lnglat -> block, negative coords included", () => {
    const samples: [number, number][] = [
      [0, 0],
      [1, -1],
      [100, -200],
      [-123456, 400000],
      [524287, -524287],
      [-400000.5, 17.25],
    ];
    for (const [x, z] of samples) {
      const { lng, lat } = blockToLngLat(x, z);
      const back = lngLatToBlock(lng, lat);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.z).toBeCloseTo(z, 6);
    }
  });

  it("keeps blocks linear in mercator space (tile/marker alignment)", () => {
    // The corner block of any display tile must map exactly onto the
    // mercator-space corner of that slippy tile: dx / 2^d.
    for (const d of [4, 8, 10]) {
      for (const [dx, dy] of [
        [0, 0],
        [2 ** d - 1, 2 ** d / 2],
        [2 ** d / 2, 2 ** d - 1],
      ] as const) {
        const bounds = displayTileToBlockBounds(d, dx, dy);
        const { lng, lat } = blockToLngLat(bounds.minX, bounds.minZ);
        const mercX = 0.5 + lng / 360;
        const mercY = latToMercatorY(lat);
        expect(mercX).toBeCloseTo(dx / 2 ** d, 10);
        expect(mercY).toBeCloseTo(dy / 2 ** d, 10);
      }
    }
  });

  it("world size constants are consistent", () => {
    expect(WORLD_SIZE_BLOCKS).toBe(2 * WORLD_RADIUS_BLOCKS);
    expect(2 ** DISPLAY_ZOOM_MAX * ORACLE_TILE_SPAN_Z0).toBe(WORLD_SIZE_BLOCKS);
  });
});
