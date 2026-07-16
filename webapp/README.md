# @seedmap/webapp

Vite + TypeScript + MapLibre GL slippy map over the [oracle HTTP API](../docs/oracle-api.md).
Vanilla TS with small DOM helpers — no framework. Biome tiles, structure markers grouped
by namespace, dimension switcher, `/locate` + biome search, shareable URL state.

## Dev

```bash
pnpm install

# Terminal 1 — a data source. Either the real oracle (seedmap run …) or the mock:
pnpm run mock                 # zero-dep node server on http://127.0.0.1:8765

# Terminal 2 — the app:
pnpm run dev                  # http://localhost:5173
```

The oracle base URL defaults to `http://127.0.0.1:8765` and can be overridden per
session with a query parameter: `http://localhost:5173/?oracle=http://127.0.0.1:9000`.

Checks: `pnpm run check` (lint + typecheck + unit tests + build). Unit tests are
pure/offline — the only sockets they open are to the mock oracle on `127.0.0.1`.

## Mock oracle

`mock/mock-oracle.mjs` is a plain `node:http` implementation of the full oracle
contract (same endpoint shapes, error format, CORS headers) with zero dependencies:

- deterministic hash-based value noise for `/biome`, `/biomes/grid` and `/tiles/**`
  (tiles are real PNGs — zlib deflate + hand-rolled chunks, no image library);
- a deterministic jittered placement grid for `/structures/*` and `/locate`;
- `/seed/verify` evaluated against the same deterministic functions;
- registries with `minecraft:` / `terralith:` / `cobbleverse:` entries.

`node mock/mock-oracle.mjs [--port 8765] [--seed 1234]`

It is a dev tool, not a worldgen model — but it is honest to the contract, so
everything the UI does against it works identically against the real oracle.

## E2E

```bash
pnpm run test:e2e             # vite build + playwright test (mock oracle + vite preview)
```

Playwright starts both servers itself (ports 8765/4173). Browsers resolve via
`PLAYWRIGHT_BROWSERS_PATH` when preinstalled; otherwise run
`pnpm exec playwright install chromium` once. The suite asserts the banner meta,
that the map canvas actually paints oracle tiles (screenshot saved to
`test-results/m1-map.png`), and that a structure marker layer toggles on/off.

## Projection — how blocks become map coordinates

All conversions live in **one module**: [`src/lib/projection.ts`](src/lib/projection.ts).

The display window is the square of blocks `[-2^19, 2^19)` on both axes, mapped
**linearly onto the normalized Web-Mercator square**:

```
mercatorX = 0.5 + blockX / 2^20        lng = (mercatorX - 0.5) * 360
mercatorY = 0.5 + blockZ / 2^20        lat = atan(sinh(pi * (1 - 2 * mercatorY))) * 180/pi
```

`lng` is linear in `blockX`; `lat` is deliberately **not** linear in `blockZ` — it is
the inverse-mercator of a linear mercator-Y ("fake mercator"). MapLibre's screen space
and tile pyramid are linear in *mercator* coordinates, so this choice makes one block
the same number of screen pixels everywhere, and makes every slippy tile boundary land
exactly on a block boundary. Raster tiles (fetched by tile index) and GeoJSON markers
(placed via `blockToLngLat`) therefore align pixel-perfectly at any latitude — a naive
equirectangular `blockZ -> lat` mapping would misplace markers relative to tiles away
from the equator. North on screen is `-Z`, east is `+X`, matching in-game F3.

## Zoom mapping — slippy vs oracle tiles

The oracle scheme (contract): `z = 0` is the **finest** level (1 px = 4 blocks, one
biome quart; tile = 1024 blocks), each `+1` doubles blocks-per-pixel, `0 <= z <= 6`,
tile indices are signed. MapLibre wants the opposite (higher zoom = finer) and
non-negative indices. The translation, unit-tested both ways:

| display zoom `d` | oracle `z = 10 - d` | tile span (blocks) | tiles across window |
| ---------------- | ------------------- | ------------------ | ------------------- |
| 4                | 6                   | 65536              | 16                  |
| 7                | 3                   | 8192               | 128                 |
| 10               | 0 (native)          | 1024               | 1024                |

```
oracle z  = 10 - d
oracle tx = dx - 2^(d-1)          oracle tz = dy - 2^(d-1)
```

At display zoom `d` there are `2^d` tiles across the `2^20`-block window, each spanning
`2^(20-d) = 1024 * 2^(10-d)` blocks — exactly the oracle tile span at `z = 10 - d`. The
`2^(d-1)` offset recenters slippy's `[0, 2^d)` indices onto the oracle's signed indices.
Map zooms 11–12 overzoom the native `z = 0` tiles (up to 1 px = 1 block).

The translation runs in a MapLibre custom protocol (`src/protocol.ts`): the raster
source uses `oracle://<base>/<dim>/<y>/{z}/{x}/{y}` templates, and the protocol loader
rewrites each request to `<base>/tiles/<dim>/<y>/<z>/<tx>/<tz>.png`. Switching
dimension or Y level swaps the source's tile template (`setTiles`).

## URL state

`#<dim>/<x>/<z>/<zoom>[/layers=<csv>]` — parsed on load, updated (debounced,
`history.replaceState`) on move and layer toggles. `layers` tokens are structure ids,
compacted to `<namespace>:*` when a whole namespace is enabled. Codec:
[`src/lib/hash-state.ts`](src/lib/hash-state.ts), unit-tested.

## Structure markers

On `moveend` (debounced) the app queries `/structures/placed` for the current bbox
(clamped to the contract's 512×512-chunk limit around the view center), with `types`
from the namespace-grouped layer toggles and `level` = `biome_ok` (default) or
`start_ok` (toggle). Marker colors encode the verification level (gray `grid`, amber
`biome_ok`, green `start_ok`); popups show the id, coordinates, level badge and a
copyable `/tp @s x ~ z`.
