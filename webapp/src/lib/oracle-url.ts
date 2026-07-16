/**
 * URL codec for the custom "oracle://" tile protocol registered with
 * maplibregl.addProtocol.
 *
 * Template handed to the raster source (before MapLibre substitutes
 * {z}/{x}/{y} with display-tile coordinates):
 *
 *     oracle://<encodeURIComponent(base)>/<encodeURIComponent(dim)>/<y>/{z}/{x}/{y}
 *
 * The loader parses the substituted URL back, converts display tile ->
 * oracle tile (see projection.ts) and fetches
 *
 *     <base>/tiles/<dim>/<y>/<oracleZ>/<tx>/<tz>.png
 */

import { displayTileToOracleTile } from "./projection";

export const ORACLE_PROTOCOL = "oracle";

export interface OracleTileRequest {
  base: string;
  dim: string;
  y: number;
  displayZoom: number;
  displayX: number;
  displayY: number;
}

/** Tile URL template for a MapLibre raster source. */
export function oracleTileUrlTemplate(
  base: string,
  dim: string,
  y: number,
): string {
  if (!Number.isInteger(y)) {
    throw new RangeError(`y level must be an integer, got ${y}`);
  }
  return (
    `${ORACLE_PROTOCOL}://${encodeURIComponent(base)}/` +
    `${encodeURIComponent(dim)}/${y}` +
    "/{z}/{x}/{y}"
  );
}

const PROTOCOL_URL_RE = new RegExp(
  `^${ORACLE_PROTOCOL}://([^/]+)/([^/]+)/(-?\\d+)/(\\d+)/(\\d+)/(\\d+)$`,
);

/** Parse a substituted oracle:// tile URL back into its parts. */
export function parseOracleTileUrl(url: string): OracleTileRequest {
  const m = PROTOCOL_URL_RE.exec(url);
  if (!m) {
    throw new Error(`malformed oracle tile URL: ${url}`);
  }
  const [, baseEnc = "", dimEnc = "", yStr = "", dStr = "", dxStr = "", dyStr = ""] = m;
  return {
    base: decodeURIComponent(baseEnc),
    dim: decodeURIComponent(dimEnc),
    y: Number(yStr),
    displayZoom: Number(dStr),
    displayX: Number(dxStr),
    displayY: Number(dyStr),
  };
}

/** HTTP URL of one oracle tile (dim keeps its literal ':' per the contract). */
export function oracleTileHttpUrl(
  base: string,
  dim: string,
  y: number,
  z: number,
  tx: number,
  tz: number,
): string {
  return `${base}/tiles/${dim}/${y}/${z}/${tx}/${tz}.png`;
}

/** Full translation: substituted oracle:// URL -> oracle HTTP tile URL. */
export function protocolUrlToHttpUrl(url: string): string {
  const req = parseOracleTileUrl(url);
  const { z, tx, tz } = displayTileToOracleTile(
    req.displayZoom,
    req.displayX,
    req.displayY,
  );
  return oracleTileHttpUrl(req.base, req.dim, req.y, z, tx, tz);
}
