# oracle-mod

The Fabric server-side mod that **is** the oracle: it embeds a localhost-only HTTP server
answering read-only worldgen queries (biomes, structures, locate, seed verification)
straight from the live `ChunkGenerator` / `BiomeSource` / structure-placement code of the
running server. It never reimplements worldgen and never loads or generates chunks in any
persistent world.

The HTTP API is specified in [`../docs/oracle-api.md`](../docs/oracle-api.md) — that
document is the contract; this README only covers building, configuring, and the v1
implementation notes.

## Build

Requires Java 21 and network access to `maven.fabricmc.net` + Mojang's servers (Loom
downloads Minecraft 1.21.1 and Yarn `1.21.1+build.1`).

```bash
cd oracle-mod
gradle wrapper --gradle-version 8.7   # once, if gradlew is not present yet
./gradlew build
```

The mod jar lands in `build/libs/oracle-mod-<version>.jar` (the `-sources` jar next to it).
Drop it into the headless server's `mods/` folder — the provisioner does this automatically.

Toolchain pins: Minecraft 1.21.1, Yarn 1.21.1+build.1, Fabric Loader 0.16.14,
Fabric API 0.116.14+1.21.1, Loom 1.6.11, Gradle 8.7, Java 21.

## Configuration

Read once at startup from `config/seedmap-oracle.json` in the server directory (written by
the provisioner before launch):

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

Every field is optional. Defaults: port `8765`, packName/packVersion `"unknown"`,
fingerprint `"unfingerprinted"`, cacheDir `seedmap-cache/` inside the server dir,
overlayDiff `[]`. A relative `cacheDir` is resolved against the server dir.

The HTTP server binds `127.0.0.1` only, starts on `SERVER_STARTED` (all worlds live) and
stops on `SERVER_STOPPING`. The bound port and endpoint list are logged at startup.

## Endpoints (v1)

`GET /meta`, `GET /biome`, `POST /biomes/grid`, `GET /tiles/{dim}/{y}/{z}/{tx}/{tz}.png`,
`GET /structures/candidates`, `GET /structures/placed`, `GET /locate`,
`GET /registry/structures`, `GET /registry/biomes`, `POST /seed/verify` — request/response
shapes exactly per the contract.

## Implementation notes (v1 semantics)

- **Threading**: HTTP workers never touch Minecraft state; every query hops to the server
  thread (`MinecraftServer#submit`) and awaits with a 30 s timeout (`internal` error on
  timeout). Grids and tiles are sampled in a single server-thread batch per request.
- **Biome prediction** uses the dimension's `BiomeSource` with the seeded multi-noise
  sampler from the server's `NoiseConfig`, sampled at quart coordinates (`block >> 2`).
  `World#getBiome` is never used (it loads chunks).
- **Structure candidates** come from the game's own placement code: random-spread start
  chunks via `RandomSpreadStructurePlacement#getStartChunk` per placement region,
  concentric rings via the calculator's precomputed positions, everything gated by the real
  `StructurePlacement#shouldGenerate`. Unknown (modded) placement types fall back to an
  exhaustive `shouldGenerate` scan capped at 512×512 chunks. Candidate bboxes are capped at
  2048×2048 chunks (the contract caps `/structures/placed` at 512×512 chunks).
- **biome_ok** samples the biome at the candidate's locate anchor at **y=64** and tests the
  structure's valid-biome list. This is a documented v1 approximation: the game evaluates
  the biome at the structure's own generation position/height, which is only known after
  start computation. `start_ok` is the game-accurate check: a real
  `Structure#createStructureStart` (same registries, noise config, template manager, the
  calculator's structure seed, references=0) must produce a start with children — this is
  bit-for-bit the vanilla `trySetStructureStart` path and is costly; request it only at
  high zoom / on demand.
- **Multi-structure sets**: every structure of a set whose checks pass at a candidate chunk
  is reported. Vanilla places at most one structure per start chunk (weighted,
  carver-seeded draw with biome/start retry); replicating the draw is planned once the
  validation harness can measure the discrepancy. In practice weighted entries of vanilla
  sets have disjoint biome predicates, so `start_ok` rarely over-reports.
- **/locate** delegates to `ChunkGenerator#locateStructure` with the vanilla `/locate`
  parameters (radius 100 chunks, `skipReferencedStructures=false`).
- **Tiles** are 256×256 PNGs rendered from the same sampler (zoom scheme per contract),
  cached under `<cacheDir>/<fingerprint>/<seed>/tiles/<dim>/<y>/<z>/<tx>/<tz>.png`. `':'`
  is replaced with `'_'` in the dimension **and** fingerprint path components (the
  contract specifies the dimension; the fingerprint contains `sha256:` and `':'` is not
  legal in Windows paths). Cached tiles are immutable
  (`Cache-Control: public, max-age=31536000, immutable`).
- **Palette**: per-biome color at runtime — `BiomeEffects` grass color if defined, else
  foliage color, else water color, else a stable FNV-1a hash of the biome id mapped to HSL
  (defensive; water color is a required biome field). Note the contract chain means vanilla
  land biomes without grass/foliage overrides share the default water hue in v1;
  `/registry/biomes` reports the exact same color so the legend always matches the tiles.
- **/seed/verify** re-parameterizes worldgen for each candidate seed without touching live
  state: a fresh `NoiseConfig` (built exactly like vanilla builds the live one) provides
  the candidate sampler for biome observations, and a candidate-seeded
  `StructurePlacementCalculator` (via `ChunkGenerator#createStructurePlacementCalculator`)
  answers structure observations. A structure observation matches when the game's
  `shouldGenerate` marks the observation's chunk as a start chunk **and** the valid-biome
  check passes with the candidate sampler (biome_ok-level; start computation is not run
  during verification). Bedrock observations return `{"match": null, "unsupported": true}`
  and are excluded from `matches`/`total` (v1.5).
- **Read-only guarantee**: no endpoint loads or generates chunks in any persistent world;
  the only disk writes are tiles under `cacheDir`.

## Verification

Every Minecraft/Fabric symbol used is listed in [`VERIFICATION.md`](VERIFICATION.md) with
raw Yarn 1.21.1 mapping evidence (plus intermediary/tiny and decompiled-source evidence
where enigma files cannot answer). If you touch the Java code, keep that file in sync —
it drives the adversarial review.
