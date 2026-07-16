/**
 * THE single source of truth for every coordinate conversion in the webapp:
 * block <-> lng/lat <-> display (slippy) tile <-> oracle tile.
 *
 * ## Projection ("linear-in-mercator fake mercator")
 *
 * The display window is the square of blocks [-2^19, 2^19) on both axes. It is
 * mapped LINEARLY onto the whole normalized Web-Mercator square [0,1]^2:
 *
 *     mercatorX = 0.5 + blockX / 2^20
 *     mercatorY = 0.5 + blockZ / 2^20
 *
 * From mercator coordinates, standard Web Mercator gives lng/lat:
 *
 *     lng = (mercatorX - 0.5) * 360            (linear in blockX)
 *     lat = atan(sinh(pi * (1 - 2*mercatorY))) * 180/pi   (NOT linear in blockZ)
 *
 * Why not a plain equirectangular mapping (lat linear in blockZ)? MapLibre's
 * screen space and tile grid are linear in *mercator* coordinates, not in
 * latitude. Making blockZ linear in mercatorY means:
 *   - 1 block = the same screen distance everywhere on the map, and
 *   - slippy tile (dx, dy) at display zoom d covers EXACTLY the square of
 *     blocks [dx*span - 2^19, ...) x [dy*span - 2^19, ...), span = 2^(20-d),
 * so raster tiles (fetched by tile index) and GeoJSON markers (placed via
 * blockToLngLat) align pixel-perfectly at every position. With lat linear in
 * blockZ the two would drift apart away from the equator.
 *
 * North on screen = -Z (minecraft north), +X = east, matching in-game F3.
 *
 * ## Zoom mapping
 *
 * The oracle's tile scheme (docs/oracle-api.md) is inverted relative to
 * slippy: oracle z = 0 is the FINEST level (1 px = 4 blocks, tile = 1024
 * blocks) and each +1 doubles blocks-per-pixel, z in [0, 6]. MapLibre wants
 * higher zoom = finer and non-negative tile indices. Therefore:
 *
 *     display zoom d in [4, 10],  oracle z = 10 - d
 *     display tile (dx, dy) -> oracle tile (tx, tz) = (dx - 2^(d-1), dy - 2^(d-1))
 *
 * At display zoom d there are 2^d x 2^d slippy tiles; each covers
 * 2^(20-d) = 1024 * 2^(10-d) blocks, which is exactly the oracle tile span at
 * z = 10 - d. The 2^(d-1) offset re-centers the non-negative slippy indices
 * onto the signed oracle indices (world origin block 0,0 sits on the corner
 * where display tiles 2^(d-1)-1 and 2^(d-1) meet).
 */

/** Blocks per pixel at oracle z = 0 (native resolution: one biome quart). */
export const NATIVE_BLOCKS_PER_PIXEL = 4;
/** Tile edge length in pixels (both schemes). */
export const TILE_SIZE_PX = 256;
/** Blocks spanned by an oracle tile at z = 0. */
export const ORACLE_TILE_SPAN_Z0 = NATIVE_BLOCKS_PER_PIXEL * TILE_SIZE_PX; // 1024
/** Oracle zoom range per docs/oracle-api.md. */
export const ORACLE_Z_MIN = 0;
export const ORACLE_Z_MAX = 6;
/** Display (slippy) zoom range; d = 10 is oracle z = 0 (finest). */
export const DISPLAY_ZOOM_MIN = 4;
export const DISPLAY_ZOOM_MAX = 10;
/** Display window: blocks [-2^19, 2^19) on both axes. */
export const WORLD_RADIUS_BLOCKS = 2 ** 19;
export const WORLD_SIZE_BLOCKS = 2 ** 20;
/** Latitude of the mercator square's north/south edges. */
export const MAX_MERCATOR_LAT = 85.05112877980659;

export interface LngLat {
  lng: number;
  lat: number;
}

export interface BlockPos {
  x: number;
  z: number;
}

export interface DisplayTile {
  d: number;
  dx: number;
  dy: number;
}

export interface OracleTile {
  z: number;
  tx: number;
  tz: number;
}

export interface BlockBounds {
  minX: number;
  minZ: number;
  /** Exclusive. */
  maxX: number;
  /** Exclusive. */
  maxZ: number;
}

function assertInt(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer, got ${value}`);
  }
}

function assertDisplayZoom(d: number): void {
  assertInt("display zoom", d);
  if (d < DISPLAY_ZOOM_MIN || d > DISPLAY_ZOOM_MAX) {
    throw new RangeError(
      `display zoom must be in [${DISPLAY_ZOOM_MIN}, ${DISPLAY_ZOOM_MAX}], got ${d}`,
    );
  }
}

function assertOracleZ(z: number): void {
  assertInt("oracle z", z);
  if (z < ORACLE_Z_MIN || z > ORACLE_Z_MAX) {
    throw new RangeError(
      `oracle z must be in [${ORACLE_Z_MIN}, ${ORACLE_Z_MAX}], got ${z}`,
    );
  }
}

/** Blocks per pixel of an oracle tile at zoom z. */
export function blocksPerPixel(z: number): number {
  assertOracleZ(z);
  return NATIVE_BLOCKS_PER_PIXEL * 2 ** z;
}

/** Blocks spanned by an oracle tile at zoom z. */
export function oracleTileSpan(z: number): number {
  assertOracleZ(z);
  return ORACLE_TILE_SPAN_Z0 * 2 ** z;
}

/** Blocks spanned by a display tile at display zoom d (same span, other index). */
export function displayTileSpan(d: number): number {
  assertDisplayZoom(d);
  return WORLD_SIZE_BLOCKS / 2 ** d;
}

export function displayZoomToOracleZ(d: number): number {
  assertDisplayZoom(d);
  return DISPLAY_ZOOM_MAX - d;
}

export function oracleZToDisplayZoom(z: number): number {
  assertOracleZ(z);
  return DISPLAY_ZOOM_MAX - z;
}

/** lat -> normalized Web-Mercator Y in [0, 1] (0 = north edge). */
export function latToMercatorY(lat: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

/** Normalized Web-Mercator Y in [0, 1] -> lat. */
export function mercatorYToLat(my: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
}

export function blockXToLng(x: number): number {
  return (x / WORLD_SIZE_BLOCKS) * 360;
}

export function lngToBlockX(lng: number): number {
  return (lng / 360) * WORLD_SIZE_BLOCKS;
}

export function blockZToLat(z: number): number {
  return mercatorYToLat(0.5 + z / WORLD_SIZE_BLOCKS);
}

export function latToBlockZ(lat: number): number {
  return (latToMercatorY(lat) - 0.5) * WORLD_SIZE_BLOCKS;
}

export function blockToLngLat(x: number, z: number): LngLat {
  return { lng: blockXToLng(x), lat: blockZToLat(z) };
}

/** Inverse of blockToLngLat; returns fractional block coordinates. */
export function lngLatToBlock(lng: number, lat: number): BlockPos {
  return { x: lngToBlockX(lng), z: latToBlockZ(lat) };
}

/** Display tile (d, dx, dy) -> oracle tile (z, tx, tz). */
export function displayTileToOracleTile(
  d: number,
  dx: number,
  dy: number,
): OracleTile {
  assertDisplayZoom(d);
  assertInt("dx", dx);
  assertInt("dy", dy);
  const n = 2 ** d;
  if (dx < 0 || dx >= n || dy < 0 || dy >= n) {
    throw new RangeError(
      `display tile (${dx}, ${dy}) out of range [0, ${n}) at zoom ${d}`,
    );
  }
  const offset = 2 ** (d - 1);
  return { z: displayZoomToOracleZ(d), tx: dx - offset, tz: dy - offset };
}

/** Oracle tile (z, tx, tz) -> display tile (d, dx, dy). */
export function oracleTileToDisplayTile(
  z: number,
  tx: number,
  tz: number,
): DisplayTile {
  assertOracleZ(z);
  assertInt("tx", tx);
  assertInt("tz", tz);
  const d = oracleZToDisplayZoom(z);
  const offset = 2 ** (d - 1);
  if (tx < -offset || tx >= offset || tz < -offset || tz >= offset) {
    throw new RangeError(
      `oracle tile (${tx}, ${tz}) outside the display window at z ${z}`,
    );
  }
  return { d, dx: tx + offset, dy: tz + offset };
}

/** Block bounds (max exclusive) covered by display tile (d, dx, dy). */
export function displayTileToBlockBounds(
  d: number,
  dx: number,
  dy: number,
): BlockBounds {
  const { z, tx, tz } = displayTileToOracleTile(d, dx, dy);
  const span = oracleTileSpan(z);
  return {
    minX: tx * span,
    minZ: tz * span,
    maxX: (tx + 1) * span,
    maxZ: (tz + 1) * span,
  };
}

/** Display tile containing block (x, z) at display zoom d. */
export function blockToDisplayTile(d: number, x: number, z: number): DisplayTile {
  assertDisplayZoom(d);
  if (
    x < -WORLD_RADIUS_BLOCKS ||
    x >= WORLD_RADIUS_BLOCKS ||
    z < -WORLD_RADIUS_BLOCKS ||
    z >= WORLD_RADIUS_BLOCKS
  ) {
    throw new RangeError(`block (${x}, ${z}) outside the display window`);
  }
  const span = displayTileSpan(d);
  return {
    d,
    dx: Math.floor((x + WORLD_RADIUS_BLOCKS) / span),
    dy: Math.floor((z + WORLD_RADIUS_BLOCKS) / span),
  };
}
