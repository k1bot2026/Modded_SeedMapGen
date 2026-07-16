# Oracle HTTP API contract (v1)

The `oracle-mod` embeds a read-only HTTP server (JDK `com.sun.net.httpserver`, bound to
`127.0.0.1`, default port `8765`). Every consumer (webapp, provisioner health check,
validation harness, verify-seed) codes against THIS document. Change it here first.

## Global rules

- **Seeds are JSON strings**, never numbers. Minecraft seeds are signed 64-bit longs;
  JSON numbers lose precision above 2^53 in JS. Applies to `/meta.seed`,
  `/seed/verify` candidates, everywhere.
- **Dimension ids** are full identifiers (`minecraft:overworld`, `minecraft:the_nether`,
  `minecraft:the_end`, plus any modded dimension registered in the server). Literal `:`
  is legal in URL path segments and query values; no escaping.
- **Biome / structure ids** are full identifiers (`terralith:alpine_grove`,
  `cobbleverse:gym_fire`).
- All coordinates are block coordinates unless a field is explicitly named `chunkX`/`quartX`.
- **Errors**: non-2xx with body `{"error": {"code": "<snake_case>", "message": "<human>"}}`.
  Codes: `bad_param`, `unknown_dimension`, `unknown_structure`, `unknown_structure_set`,
  `not_found`, `too_large`, `internal`.
- **CORS**: every response carries `Access-Control-Allow-Origin: *`;
  `OPTIONS` preflight answered with `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  and `Access-Control-Allow-Headers: Content-Type`. The oracle binds localhost-only;
  CORS exists so the Vite dev server origin can call it.
- **Read-only guarantee**: no endpoint may load or generate chunks in any persistent
  world, or write anything outside the tile cache directory.
- The oracle reads its config from `config/seedmap-oracle.json` in the server dir
  (written by the provisioner before launch):

```json
{
  "port": 8765,
  "packName": "Cobbleverse",
  "packVersion": "1.7.2",
  "packFingerprint": "sha256:abcd…",
  "cacheDir": "/abs/path/runs/<name>/cache",
  "overlayDiff": []
}
```

Missing file ⇒ defaults (`port` 8765, `packName` `"unknown"`, fingerprint `"unfingerprinted"`,
`cacheDir` `seedmap-cache/` inside the server dir).

## Endpoints

### `GET /meta`

```json
{
  "mcVersion": "1.21.1",
  "loaderVersion": "0.16.14",
  "oracleModVersion": "0.1.0",
  "seed": "-1234567890123456789",
  "packName": "Cobbleverse",
  "packVersion": "1.7.2",
  "packFingerprint": "sha256:abcd…",
  "overlayDiff": [],
  "dimensions": ["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"],
  "mods": [{ "id": "fabric-api", "version": "0.116.14+1.21.1", "name": "Fabric API" }]
}
```

`mods` lists all loaded Fabric mods (id, version, display name). `overlayDiff` echoes the
provisioner-computed drift report (array of `{path, kind: "added"|"replaced"|"removed"}`).

### `GET /biome?dim=<id>&x=<int>&y=<int>&z=<int>`

Predicted biome via the dimension's `BiomeSource` + seeded `MultiNoiseUtil.MultiNoiseSampler`
sampled at quart coordinates (`>> 2`). NEVER via `World#getBiome` (would load chunks).

```json
{ "dim": "minecraft:overworld", "x": 100, "y": 64, "z": -200, "biome": "terralith:alpine_grove" }
```

### `POST /biomes/grid`

Request:

```json
{ "dim": "minecraft:overworld", "y": 64, "minX": -1024, "minZ": -1024, "step": 4, "w": 256, "h": 256 }
```

- Sample point `(row, col)` is block `(minX + col*step, y, minZ + row*step)`; `col` runs
  along X, `row` along Z. `w*h` capped at 262144 (512×512) ⇒ `too_large` above.
- Response is palette-compressed, `data` row-major (`data[row*w + col]` indexes `palette`):

```json
{
  "dim": "minecraft:overworld", "y": 64, "minX": -1024, "minZ": -1024,
  "step": 4, "w": 256, "h": 256,
  "palette": ["minecraft:plains", "terralith:alpine_grove"],
  "data": [0, 0, 1]
}
```

### `GET /tiles/{dim}/{y}/{z}/{tx}/{tz}.png`

Rendered biome tile, 256×256 px PNG.

- **Zoom scheme**: `z = 0` is native resolution — 1 px = 4 blocks (one biome quart), i.e.
  one tile spans 1024×1024 blocks. Each zoom-out level doubles blocks-per-pixel:
  at zoom `z`, 1 px = `4 * 2^z` blocks, tile spans `1024 * 2^z` blocks. Range `0 ≤ z ≤ 6`.
- Tile indices may be negative: tile `(tx, tz)` covers blocks
  `[tx * span, (tx+1) * span)` × `[tz * span, (tz+1) * span)` where `span = 1024 * 2^z`.
- `y` is the sampling Y level (integer, may be negative).
- Palette: per-biome color derived at runtime — grass color if the biome defines one,
  else foliage color, else water color, else a stable FNV-1a hash of the biome id mapped
  to HSL. Modded biomes need zero configuration.
- Disk cache: `<cacheDir>/<packFingerprint>/<seed>/tiles/<dim with ':' → '_'>/<y>/<z>/<tx>/<tz>.png`.
  Serve from cache when present; `Cache-Control: public, max-age=31536000, immutable`
  (a tile for a fixed fingerprint+seed never changes).
- Content-Type `image/png`.

### `GET /structures/candidates?dim=<id>&structureSet=<id>&minX=&minZ=&maxX=&maxZ=`

Placement-grid candidates (cheap, no biome check) from the dimension's
`StructurePlacementCalculator` for one structure set, within a block-coordinate bbox.

```json
{
  "dim": "minecraft:overworld",
  "structureSet": "minecraft:villages",
  "candidates": [ { "chunkX": 5, "chunkZ": -3, "blockX": 80, "blockZ": -48 } ]
}
```

`blockX/blockZ` are the chunk-center-ish anchor (`chunk << 4` + 8 is fine; markers refine later).

### `GET /structures/placed?dim=<id>&minX=&minZ=&maxX=&maxZ=[&types=id1,id2][&level=biome_ok|start_ok]`

Candidates that pass verification. `level` defaults to `biome_ok`.
Verification levels (also returned per feature):

1. `grid` — placement candidate only;
2. `biome_ok` — candidate whose structure's biome predicate passes at the anchor;
3. `start_ok` — a real `StructureStart` was computed and is valid (game-accurate,
   costlier — request only at high zoom / on demand).

```json
{
  "dim": "minecraft:overworld",
  "features": [
    {
      "id": "cobbleverse:gym_fire",
      "structureSet": "cobbleverse:gyms",
      "x": 1234, "z": -880,
      "chunkX": 77, "chunkZ": -55,
      "level": "start_ok"
    }
  ]
}
```

`types` filters by structure id. bbox limited to 512×512 chunks per request ⇒ `too_large`.

### `GET /locate?dim=<id>&x=<int>&z=<int>&structure=<id or #tag>`

Nearest structure via `ChunkGenerator#locateStructure` — the same code path as the vanilla
`/locate structure` command. `structure` accepts a structure id or a `#`-prefixed tag id.

```json
{ "structure": "minecraft:village_plains", "x": 1424, "z": -368, "distance": 1502.3 }
```

Not found ⇒ 404 with error code `not_found`.

### `GET /registry/structures`

```json
{
  "structures": [
    {
      "id": "cobbleverse:gym_fire",
      "namespace": "cobbleverse",
      "sets": ["cobbleverse:gyms"],
      "dimensions": ["minecraft:overworld"]
    }
  ]
}
```

`sets` = every structure set referencing this structure; `dimensions` = dimensions whose
placement calculator has at least one of those sets.

### `GET /registry/biomes`

```json
{
  "biomes": [
    { "id": "terralith:alpine_grove", "namespace": "terralith", "color": "#6a9f4b" }
  ]
}
```

`color` is the exact tile-palette color (hex, no alpha) so the webapp legend matches tiles.

### `POST /seed/verify`

```json
{
  "candidates": ["1234", "-5678"],
  "observations": [
    { "type": "biome", "dim": "minecraft:overworld", "x": 0, "y": 64, "z": 0, "expected": "minecraft:plains" },
    { "type": "structure", "dim": "minecraft:overworld", "x": 1424, "z": -368, "expected": "minecraft:village_plains" }
  ]
}
```

Response:

```json
{
  "results": [
    {
      "seed": "1234",
      "matches": 7,
      "total": 8,
      "verdict": "mismatch",
      "details": [
        { "index": 0, "match": true, "actual": "minecraft:plains" }
      ]
    }
  ]
}
```

- Biome observations: re-parameterize the multi-noise sampler for the candidate seed
  (no server restart).
- Structure observations: candidate-seeded placement calculation; `match` = a structure
  of the expected type is placed in the observation's chunk.
- `type: "bedrock"` observations are v1.5 (throwaway-world generation): respond per-detail
  `{"match": null, "unsupported": true}` and exclude from `matches`/`total`.
- `verdict`: `"match"` if `matches == total` and `total > 0`, else `"mismatch"`.
- ≤ 16 candidates, ≤ 256 observations ⇒ `too_large` above.

## `runs/` layout (provisioner-owned)

```
runs/<name>/                 # e.g. cobbleverse-1.7.2, vanilla-1.21.1
  run.json                   # manifest: pack ref, pinned version, fingerprint, file hashes
  server/                    # assembled headless server (mods/, config/, libraries, …)
    config/seedmap-oracle.json
    eula.txt                 # only written after explicit --accept-eula
    server.properties        # level-seed, view-distance=2, spawn-protection=0, max-tick-time=-1, online-mode=false, level-name=world-oracle
  cache/                     # tile cache root (oracle writes here, see cacheDir)
  logs/
```

## Fingerprint definition

`packFingerprint = "sha256:" + sha256(sorted per-file lines)` where each line is
`sha512(file) + "  " + normalized-relative-path + "\n"` for every file under `mods/`,
`config/`, and `world/datapacks/` in the assembled server dir (overlay excluded — overlay
drift is reported separately). Paths use `/` separators on all platforms. The provisioner
computes it and writes it into `run.json` + `config/seedmap-oracle.json`.
