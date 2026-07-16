/**
 * Shareable URL state codec.
 *
 * Format: `#<dim>/<x>/<z>/<zoom>[/layers=<csv>]`
 *   - dim:   full dimension id (contains ':', never '/')
 *   - x, z:  integer block coordinates of the view center
 *   - zoom:  display zoom, up to 2 decimals
 *   - layers: optional csv of enabled structure-layer tokens
 *     (full structure ids, or `<namespace>:*` for a whole namespace)
 */

export interface HashState {
  dim: string;
  x: number;
  z: number;
  zoom: number;
  layers?: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatHash(state: HashState): string {
  const { dim, layers } = state;
  const x = Math.round(state.x);
  const z = Math.round(state.z);
  const zoom = round2(state.zoom);
  let hash = `#${dim}/${x}/${z}/${zoom}`;
  if (layers && layers.length > 0) {
    hash += `/layers=${layers.join(",")}`;
  }
  return hash;
}

/** Parse a location.hash value; returns null when it does not decode. */
export function parseHash(hash: string): HashState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  const parts = raw.split("/");
  if (parts.length < 4 || parts.length > 5) return null;
  const [dim, xStr, zStr, zoomStr, extra] = parts;
  if (!dim || !dim.includes(":")) return null;
  const x = Number(xStr);
  const z = Number(zStr);
  const zoom = Number(zoomStr);
  if (
    xStr === "" ||
    zStr === "" ||
    zoomStr === "" ||
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }
  const state: HashState = { dim, x: Math.round(x), z: Math.round(z), zoom: round2(zoom) };
  if (extra !== undefined) {
    if (!extra.startsWith("layers=")) return null;
    const layers = extra
      .slice("layers=".length)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (layers.length > 0) state.layers = layers;
  }
  return state;
}
