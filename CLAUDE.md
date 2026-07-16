# CLAUDE.md — Modpack Seedmap (Oracle)

Web application that renders a **fully correct seed map for modded Minecraft** (biomes + structures, all dimensions) by querying the *real* world generator of a headless server instance instead of reimplementing worldgen.

Primary target: the owner's **Cobbleverse** server (**remote-hosted** — no filesystem access in the primary flow; Minecraft **1.21.1, Fabric**, Cobblemon 1.7.x, includes Terralith + custom `cobbleverse:` structures + Legendary Monuments). Packs are ingested from **Modrinth (primary)** or **CurseForge (secondary)** by link/zip. The design must stay pack-agnostic: any Fabric 1.21.1 pack should work.

## Core principle — the Oracle rule

> **Never reimplement worldgen. Ever.** All biome and structure answers come from the actual `ChunkGenerator` / `BiomeSource` / structure-placement code of a live (headless) server running the exact mods, datapacks, and configs of the target pack. If a value can be asked from the game, ask the game.

Corollaries:
- If a feature seems to require porting mod logic to TypeScript/JS: stop, redesign so the oracle answers it instead.
- Accuracy claims in the UI must be honest: every map is a **prediction for one specific pack version + seed**; the version/fingerprint banner must make unambiguous which one.
- In a remote-hosted setup, correctness is anchored by two user inputs: the **exact pack version** (pin it; never resolve "latest" silently — for a "world state at creation" map, pick the version the world was created with) and the **exact seed** (from `/seed` in-game). Warn loudly on version ambiguity or fingerprint mismatch.
- The app is fully **standalone**: it never connects to the user's game client or live server. The embedded headless instance is an internal compute engine only — provisioned and owned by this app, `127.0.0.1`-bound, `online-mode=false`, no player joins — invisible to the user, who supplies nothing but a pack reference, version, and seed. Any in-game checks mentioned in milestone gates are manual QA performed by the owner, never an app dependency.

## Non-goals (v1)

- No Forge/NeoForge support (Fabric 1.21.x only).
- No brute-force seed *finding* (searching millions of seeds for desired features, à la Cubiomes Viewer) — ever. The oracle evaluates one seed perfectly; it cannot evaluate millions per second.
- No seed *cracking* from raw observations in v1 (lattice-reduction math over Minecraft's RNG, vanilla-only assumptions; prior art: SeedcrackerX). v1 ships seed **verification** instead — see component 4. Full recovery is a v2 stretch.
- No reading of actual world data (region files / backups): the map shows what the selected pack version generates from the seed. Chunks in a live world may have been generated under older pack versions; the version picker is how the user chooses which state they care about.
- No public multi-tenant SaaS. Single-user, runs locally.
- No terrain/heightmap 3D rendering (optional later; biome map + markers first).
- Never write to or load chunks in the production world.
- No dependency on filesystem access to the production server; config overlays are an optional extra supplied by the user.

## System requirements (target: "any PC")

- **No Minecraft installation, launcher, or Microsoft account required.** The provisioner downloads the official Mojang server jar, the Fabric loader, and pack files itself.
- Java 21 runtime (`doctor` detects it; may offer to auto-download a Temurin 21 JRE into the app directory).
- ~4 GB free RAM for the headless instance with a heavy pack (default heap `-Xmx4G`, configurable); a few GB disk per provisioned run.
- macOS, Windows, Linux. No GPU needed.

## Repository layout (monorepo)

```
modpack-seedmap/
├── CLAUDE.md                  # this file
├── oracle-mod/                # Fabric server-side mod (Java 21, Fabric Loom, Yarn mappings)
├── provisioner/               # TypeScript CLI: pack ingestion → headless server assembly → lifecycle
├── webapp/                    # Vite + TypeScript + MapLibre GL frontend
├── validation/                # correctness harness: oracle vs /locate vs independent re-runs
└── runs/                      # generated: assembled servers, tile caches, logs (gitignored)
```

## Component specs

### 1. `oracle-mod` (Fabric, the heart of correctness)

A small server-side mod that embeds an HTTP server (JDK built-in `com.sun.net.httpserver`, bind `127.0.0.1`, port from config, JSON via Gson) exposing read-only worldgen queries.

Endpoints (v1):
- `GET /meta` → MC version, mod list + versions, dimensions, raw seed (owner opted in to visibility), pack fingerprint (hash of mods+datapacks+relevant configs), overlay drift report if an overlay was applied.
- `GET /biome?dim=&x=&y=&z=` → single biome id (predicted).
- `POST /biomes/grid` → bulk sampling: `{dim, y, minX, minZ, step, w, h}` → array of biome ids. This powers tiles; must be fast (thousands of samples per call).
- `GET /tiles/{dim}/{y}/{zoom}/{tx}/{tz}.png` → rendered biome tile (256×256 px, 1 sample per 4 blocks at zoom 0), disk-cached under `runs/<packFingerprint>/<seed>/tiles/`. Palette is derived at runtime from each biome's registered grass/foliage/water colors (fallback: stable hash → color), so modded biomes (Terralith etc.) render in their real hues with zero per-mod configuration.
- `GET /structures/candidates?dim=&structureSet=&bbox=` → placement-grid candidate chunk positions (cheap, no biome check).
- `GET /structures/placed?dim=&bbox=&types=` → candidates that pass biome + `Structure` start checks (this is the map-marker layer).
- `GET /locate?dim=&x=&z=&structure=` → delegates to the same code path as the vanilla `/locate structure` command; used by the validation harness as internal ground truth.
- `POST /seed/verify` → seed verification (see component 4).
- `GET /registry/structures`, `GET /registry/biomes` → ids + display names + source namespace (`minecraft:` / `terralith:` / `cobbleverse:` / …) so the UI can group filters by mod.

Implementation notes (verify exact names against **Yarn 1.21.1** — do not trust memory for signatures):
- Biome prediction: use the dimension's `ChunkGenerator#getBiomeSource()` with the seeded noise sampler (`MultiNoiseUtil.MultiNoiseSampler` obtained from the server's `NoiseConfig`); sample at **quart coordinates** (`blockCoord >> 2`). Do NOT use `World#getBiome` for prediction — that loads/generates chunks.
- Structure candidates: the server's `StructurePlacementCalculator` (+ each `StructureSet`'s `StructurePlacement#shouldGenerate` / start-chunk logic).
- Structure verification levels, exposed as `level` field:
  1. `grid` — placement candidate only;
  2. `biome_ok` — candidate + biome predicate passes;
  3. `start_ok` — a real `StructureStart` was computed (game-accurate, incl. jigsaw start rules; costlier — compute lazily/on zoom).
- Nearest-search must reuse `ChunkGenerator#locateStructure` (the `/locate` backend) rather than a homemade spiral.
- Threading: anything touching `ServerWorld`/registries goes through `server.execute()` + futures. Pure-math sampling (noise sampler) may run on worker threads only after verifying thread-safety; default to the safe path first, optimize later.
- The oracle must be able to run against a **fresh throwaway world** (`level-name=world-oracle`) — it only needs the generator, not terrain. Startup flag `--oracle-only` may suppress spawn-chunk generation if feasible.

### 2. `provisioner` (TypeScript CLI, Node 22, pnpm)

Turns a pack reference into a running oracle. Commands:

```
seedmap provision modrinth <slug|url|.mrpack> [--version <v>] [--overlay <zip|dir>]   # PRIMARY flow
seedmap provision curseforge <zip|serverpack.zip> [--overlay <zip|dir>]               # secondary
seedmap provision local <serverDir>                                                    # advanced/optional
seedmap run <runDir> --seed <seed> [--dim ...] [--port 8765]
seedmap verify-seed <runDir> --observations <file.json> --candidates <seed,...>
seedmap doctor [<runDir>]                      # java 21 discovery (+ optional Temurin auto-install), MC/loader versions, missing jars, eula
```

Ingestion rules:
- **modrinth (primary)**: fetch `.mrpack` via public API (set a proper `User-Agent`); parse `modrinth.index.json`; download files verifying SHA-512; **skip entries with `env.server == "unsupported"`**; apply `overrides/` then `server-overrides/`. Version selection is explicit and interactive (list versions, user picks the one that matters — for "state at creation", the version the world was created with); never silently resolve "latest".
- **curseforge (secondary)**: parse `manifest.json` (projectID/fileID); resolve via CurseForge Core API (`CURSEFORGE_API_KEY` env); mods with third-party downloads blocked → list them and wait for manual drop-in under `mods-manual/`. If the pack ships an official **Server Pack** zip, prefer extracting that wholesale.
- **overlay (optional, applied last)**: user-supplied zip/dir mirroring server layout (`config/`, `world/datapacks/`, `server.properties`) to reproduce server-side tweaks — grabbed manually via the host panel's file manager or SFTP. Overlay contents are diffed against pack defaults and the drift is reported in `/meta`.
- **local (advanced, optional)**: only when filesystem access exists: copy (never symlink-with-write) `mods/`, `config/`, `world/datapacks/`, read `server.properties` (`level-seed` → default seed) and loader version; strip player/world data; point at fresh `world-oracle/`.
- Always: install matching Fabric loader via the official installer, inject `oracle-mod` jar, write `eula.txt` only after explicit `--accept-eula`, generate `server.properties` (seed, `view-distance=2`, `spawn-protection=0`, `max-tick-time=-1`), launch with Java 21, wait for `/meta` health check.

### 3. `webapp` (Vite + TS + MapLibre GL)

- Slippy map fed by oracle tiles; dimension switcher (all registered dimensions from `/meta`, not hardcoded three).
- Structure marker layers grouped by namespace with per-type toggles (villages… / `terralith:*` / `cobbleverse:*` gyms / monuments); marker popup shows coords, structure id, verification `level`, copyable `/tp`.
- Search: nearest structure of type X from a clicked point (uses `/locate`); biome search (nearest biome via sampling rings — implemented server-side in oracle later, client brute force is acceptable for M2).
- Banner: pack name, pinned version, fingerprint, seed.
- Shareable URL state (`#dim/x/z/zoom/layers`).

### 4. `seed-recovery` (v1: verify-mode; v2 stretch: cracking)

- **v1 — verification.** `POST /seed/verify`: `{candidates: [seeds], observations: [{type: biome|structure|bedrock, dim, pos, expected}]}` → per-candidate match report. Biome/structure observations are checked via samplers/placement calculators parameterized per candidate seed (no restart needed if feasible); bedrock observations require generating the observed chunk's surface in a throwaway world per candidate — acceptable for small candidate lists (≤10). This answers "is this the right seed?" with modpack-exact certainty.
- **v2 stretch — recovery from observations alone.** Lattice-reduction based cracking (interop with SeedcrackerX output formats rather than reimplementing where possible). Explicitly research-grade, vanilla-math-bound; keep out of v1 scope and architecture.

### 5. `validation` (the correctness harness — this project's soul)

Automated, run in CI-style locally:
- `validate locate`: N=200 random origins per dimension → compare oracle `/structures/placed` nearest result vs oracle `/locate` (vanilla code path) → must agree 100% on position for every registered structure type sampled.
- `validate self-consistency`: provision + boot the same pack version + seed twice independently → sampled biome grids, placed-structure sets, and tile hashes must be byte-identical (guards nondeterminism and threading bugs).
- `validate vanilla-baseline`: fresh vanilla 1.21.1 (no mods) run → compare committed fixture coordinates (villages/strongholds/biomes for a fixed seed, generated once from a cubiomes reference) → must match (sanity that the harness itself works).
- Every milestone below has a machine-checkable gate; do not advance while a gate fails.

## Milestones — artifact-based, no time estimates

Each milestone = deliverables + **Done when** (checks Claude Code can run; manual QA items are explicitly labeled and recorded in the PR, never blocking automation).

- **M0 — Scaffold.**
  Deliverables: monorepo (pnpm workspaces + Gradle/Loom project); `pnpm check` runs lint+build across packages.
  Done when: `./gradlew build` produces `oracle-mod-*.jar`; `seedmap run runs/vanilla --seed 1234 --accept-eula` boots vanilla 1.21.1 with the mod; `curl :8765/meta` returns JSON with `mcVersion == "1.21.1"` and the mod listed.

- **M1 — Vanilla biomes.**
  Deliverables: `/biome`, `/biomes/grid`, `/tiles/**`; webapp shows a pannable/zoomable biome map.
  Done when: `validate vanilla-baseline` passes; a scripted 5×5-viewport tile fetch succeeds and is served from cache on the second pass; a headless-browser test saves `runs/**/m1-map.png` showing rendered tiles.

- **M2 — Cobbleverse via Modrinth.**
  Deliverables: `provision modrinth` end-to-end with explicit version pinning.
  Done when: `provision modrinth cobbleverse --version <pinned>` + `run` yields `/meta` with the pinned version + fingerprint; `/registry/biomes` contains ≥1 `terralith:` id; an automated grid check at a committed fixture coordinate returns a `terralith:` biome. Manual QA (owner, recorded in PR): 10 in-game F3 spot-checks on the live server match the map — the app itself has no game connection.

- **M3 — Structures.**
  Deliverables: candidates/placed endpoints with `grid`/`biome_ok`/`start_ok` levels; namespace-grouped marker UI with filters.
  Done when: `validate locate` passes 100%; `/registry/structures` includes `cobbleverse:` ids; a headless-browser test asserts at least one `cobbleverse:` marker renders for the fixture seed.

- **M4 — CurseForge + overlays.**
  Deliverables: CurseForge provisioning (server-pack shortcut + blocked-mod flow); `--overlay` with drift reporting.
  Done when: the same pack version provisioned via Modrinth and via CurseForge yields byte-identical fingerprints (automated diff, overlay excluded); an overlay fixture produces the expected `overlayDiff` in `/meta`.

- **M5 — Seed-verify + polish.**
  Deliverables: `/seed/verify` + `seedmap verify-seed`; biome search; share URLs; tile cache eviction; `doctor` (incl. Java discovery/auto-install path); README quickstart.
  Done when: verify-seed fixture test passes (correct seed + 5 mixed observations → match; off-by-one seed → mismatch); `validate self-consistency` passes; README quickstart executes cleanly on a fresh checkout (documented manual run, recorded in PR).

## Conventions & guardrails

- Java 21 / Fabric Loom / Yarn for `oracle-mod`; TypeScript strict everywhere else; pnpm workspaces.
- Look up all Minecraft/Yarn API names in the actual 1.21.1 mappings and Fabric docs before coding; never code MC internals from memory.
- Cross-platform is a requirement, not a nice-to-have: provisioner, oracle, and webapp run on macOS, Windows, and Linux; no hardcoded platform paths; CI-style checks should at minimum run on the dev machine plus one other OS when available.
- The oracle is **read-only** and binds to localhost. No endpoint may cause chunk generation or world writes outside the throwaway world.
- Never point any component with write access at the production `world/`.
- Legal hygiene: never redistribute downloaded mod jars or the assembled server (`runs/` is gitignored); EULA acceptance is an explicit user flag; respect Modrinth UA policy and CurseForge API ToS.
- Performance budget: full-screen biome tile fetch < 1 s warm-cache, < 10 s cold on a typical dev machine (reference: Mac mini M4); structure `start_ok` verification lazy.
- Commit style: conventional commits; each milestone lands as a reviewed PR with its validation gate output pasted in the description.

## Open questions (ask the owner before assuming)

1. Should `doctor` auto-download a Temurin 21 JRE when no Java 21 is found (default: prompt, `--yes` to skip), or only print install instructions?
2. Is the default heap of `-Xmx4G` for the headless instance acceptable on all machines you plan to run this on, or should the default be lower with a warning for heavy packs?
