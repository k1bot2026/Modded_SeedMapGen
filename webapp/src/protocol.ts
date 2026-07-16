import { addProtocol } from "maplibre-gl";
import { ORACLE_PROTOCOL, protocolUrlToHttpUrl } from "./lib/oracle-url";

/**
 * Register the "oracle" tile protocol with MapLibre: translates slippy tile
 * requests (display zoom/tile indices substituted into the source template)
 * into oracle HTTP tile URLs (inverted zoom, signed tile indices) and
 * returns the PNG bytes. See src/lib/projection.ts for the math.
 */
export function registerOracleProtocol(onTileLoaded?: () => void): void {
  addProtocol(ORACLE_PROTOCOL, async (params, abortController) => {
    const httpUrl = protocolUrlToHttpUrl(params.url);
    const response = await fetch(httpUrl, { signal: abortController.signal });
    if (!response.ok) {
      throw new Error(`oracle tile failed: HTTP ${response.status} for ${httpUrl}`);
    }
    const data = await response.arrayBuffer();
    onTileLoaded?.();
    const cacheControl = response.headers.get("cache-control");
    return { data, ...(cacheControl !== null ? { cacheControl } : {}) };
  });
}
