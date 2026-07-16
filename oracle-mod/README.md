# oracle-mod

The Fabric server-side mod that **is** the oracle: it embeds a localhost-only HTTP server
answering read-only worldgen queries (biomes, structures, locate, seed verification)
straight from the live `ChunkGenerator` / `BiomeSource` / structure-placement code of the
running server. It never reimplements worldgen and is read-only toward everything except
the throwaway world it runs against (`level-name=world-oracle`): `/locate` may compute
structure starts there (see the contract's read-only guarantee), and tiles are cached to
disk. Production worlds are never touched.

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
- **biome_ok** samples the biome at the candidate's locate anchor at the contract's three
  quart-Y probes (block Y **−48, 0, 64** — covering deep/cave/surface structures such as
  `minecraft:ancient_city`) and passes if the structure's valid-biome list contains ANY
  probe biome. This is contract-documented behavior but still an approximation of the
  per-structure generation height: the game evaluates the biome at the structure's own
  generation position/height, which is only known after start computation. A cheap exact
  short-circuit drops structures whose valid-biome list shares nothing with the dimension's
  `BiomeSource#getBiomes()`. `start_ok` is the game-accurate check: a real
  `Structure#createStructureStart` (same registries, noise config, template manager, the
  calculator's structure seed, references=0) must produce a start with children — this is
  bit-for-bit the vanilla `trySetStructureStart` path and is costly; request it only at
  high zoom / on demand.
- **Multi-structure sets**: at `grid`/`biome_ok`, every structure of a set whose checks pass
  at a candidate chunk is reported (contract behavior — those levels are prefilters). At
  `start_ok` the vanilla per-start-chunk draw is replicated exactly
  (`PlacementScan#weightedWinner`, transcribed from the decompiled
  `ChunkGenerator#setStructureStarts`): single-entry sets skip the draw; multi-entry sets
  seed a `ChunkRandom` via `setCarverSeed(structureSeed, chunkX, chunkZ)` and run weighted
  elimination — pick a weighted random entry, keep it if its start computes, otherwise
  remove it and redraw. Only the winner is reported.
- **/locate** delegates to `ChunkGenerator#locateStructure` with the vanilla `/locate`
  parameters (radius 100 chunks, `skipReferencedStructures=false`). By-design side effect
  (documented in the contract's read-only guarantee): the vanilla path may compute
  structure starts and persist STRUCTURE_STARTS-stage proto-chunks in the throwaway world.
- **Tiles** are 256×256 PNGs rendered from the same sampler (zoom scheme per contract),
  cached under `<cacheDir>/<fingerprint>/<seed>/tiles/<dim>/<y>/<z>/<tx>/<tz>.png`. Per the
  contract, `':'` is replaced with `'_'` in **both** the fingerprint and dimension path
  components (Windows forbids `':'` in path segments). Cached tiles are immutable
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
  answers structure observations. A structure observation matches when the game, generating
  with the candidate seed, would place a structure of the expected type in the observation's
  chunk — game-accurate: the game's `shouldGenerate` marks the chunk as a start chunk, the
  vanilla weighted elimination draw picks the expected structure (multi-entry sets), and a
  real candidate-seeded `StructureStart` computes with children. An exact short-circuit
  skips structures with no valid biome in the dimension. Bedrock observations return
  `{"match": null, "unsupported": true}` and are excluded from `matches`/`total` (v1.5).
- **Read-only guarantee**: per the contract, no endpoint loads or generates chunks in, or
  writes to, any world other than the throwaway `world-oracle` world. `/locate` may compute
  structure starts and persist STRUCTURE_STARTS-stage proto-chunks **in that throwaway
  world** (by design — the vanilla code path is the validation ground truth); the only
  other disk writes are tiles under `cacheDir`.

## Verification

Every Minecraft/Fabric symbol used is listed in [`VERIFICATION.md`](VERIFICATION.md) with
raw Yarn 1.21.1 mapping evidence (plus intermediary/tiny and decompiled-source evidence
where enigma files cannot answer). If you touch the Java code, keep that file in sync —
it drives the adversarial review.
