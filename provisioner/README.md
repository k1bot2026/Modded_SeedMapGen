# @seedmap/provisioner

The `seedmap` CLI: turns a Fabric 1.21.1 modpack reference into a running, localhost-only
**worldgen oracle** — pack ingestion (Modrinth / CurseForge / local) → headless server
assembly → lifecycle (`run`, `verify-seed`, `doctor`).

Contracts this package codes against (change them there first):

- [`../CLAUDE.md`](../CLAUDE.md) — project spec (the Oracle rule, ingestion rules, milestones)
- [`../docs/oracle-api.md`](../docs/oracle-api.md) — the oracle HTTP API, `runs/` layout,
  `config/seedmap-oracle.json`, and the **fingerprint definition**

```bash
pnpm install
pnpm run check        # lint + typecheck + test + build
node dist/cli.js --help   # or: pnpm start -- --help
```

## Command reference

### `seedmap provision modrinth <slug|url|.mrpack>` — PRIMARY

```bash
seedmap provision modrinth cobbleverse                      # lists versions, then exits
seedmap provision modrinth cobbleverse --version 1.7.2      # exact version number
seedmap provision modrinth cobbleverse --version AbCdEf12   # or exact version id
seedmap provision modrinth https://modrinth.com/modpack/cobbleverse/version/1.7.2
seedmap provision modrinth ./Cobbleverse-1.7.2.mrpack       # local .mrpack file
# options: --overlay <zip|dir> --out <dir> --oracle-jar <jar>
```

- Talks to `https://api.modrinth.com/v2` with the User-Agent
  `modpack-seedmap/0.1.0 (github.com/k1bot2026/Modded_SeedMapGen)`.
- **Version pinning is explicit.** With `--version` omitted the CLI prints the version
  table and exits non-zero — "latest" is never resolved silently. For a
  "world state at creation" map, pick the version the world was created with.
  `--version` accepts an exact version id or a version number (ambiguity is an error
  listing the ids).
- Parses `modrinth.index.json`; every download is **SHA-512 verified** (a mismatch
  discards the file and aborts). Entries with `env.server == "unsupported"` are skipped
  and reported. `overrides/` is applied, then `server-overrides/` on top.
- A pack-shipped `eula.txt` is always stripped: EULA acceptance is yours alone
  (`seedmap run --accept-eula`).

### `seedmap provision curseforge <zip|serverpack.zip>` — secondary

```bash
export CURSEFORGE_API_KEY=...   # https://console.curseforge.com/
seedmap provision curseforge ./MyPack-2.0.1.zip [--overlay ...] [--out ...]
```

- A zip with `manifest.json` is resolved file-by-file (`projectID`/`fileID`) via the
  CurseForge Core API; SHA-1 verified where CurseForge publishes hashes; the manifest's
  `overrides/` folder is applied on top.
- Mods whose authors **block third-party downloads** are listed with their CurseForge
  links; the CLI waits while you download them manually into `<runDir>/mods-manual/`
  (re-running the same command resumes; in non-interactive shells it exits with
  instructions instead of waiting).
- If the zip **is** an assembled server pack (heuristic: has `mods/`, no
  `manifest.json`) it is extracted wholesale.

### `seedmap provision vanilla --mc 1.21.1`

No pack: vanilla + oracle only (this is the M0 gate). Also fetches the pinned Fabric API
(the oracle mod's dependency) from Modrinth.

```bash
seedmap provision vanilla --mc 1.21.1 --out runs/vanilla
```

### `seedmap provision local <serverDir>` — advanced

Copies `mods/`, `config/`, `world/datapacks/` from an existing server directory —
**contents only, never symlinks, never player or chunk data** — and reads
`level-seed` from its `server.properties` as the default seed for `run`.
Loader version falls back to the pinned Fabric loader (0.16.14).

### `seedmap run <runDir> --seed <seed> [--port 8765] [--heap 4G] [--accept-eula] [--dim ...]`

```bash
seedmap run runs/cobbleverse-1.7.2 --seed -4530634556500121041 --accept-eula
```

1. Completes any assembly pieces provisioning deferred (Mojang `server.jar` via
   piston-meta, SHA-1 verified; Fabric server launcher from meta.fabricmc.net as
   `fabric-server-launch.jar` + `fabric-server-launcher.properties` with
   `serverJar=server.jar` — the launcher pattern, no installer run; oracle mod jar from
   `../oracle-mod/build/libs/` or `--oracle-jar`).
2. Writes `server.properties` (preserving pack/overlay-provided keys) forcing
   `level-seed=<seed>`, `level-name=world-oracle`, `online-mode=false`,
   `view-distance=2`, `spawn-protection=0`, `max-tick-time=-1`.
3. Writes `config/seedmap-oracle.json` per the contract (`port`, `packName`,
   `packVersion`, `packFingerprint`, `cacheDir=<runDir>/cache`, `overlayDiff`).
4. **EULA gate**: `eula.txt` is written only with `--accept-eula`
   (<https://aka.ms/MinecraftEULA>); otherwise the command exits with instructions.
   A previously recorded acceptance in the run dir keeps counting.
5. Deletes any stale `world-oracle/` (Minecraft only applies `level-seed` at world
   creation — a stale world would silently pin the previous seed).
6. Discovers Java 21+ (seedmap-managed JRE, `JAVA_HOME`, `PATH`, common install dirs),
   spawns `java -Xmx<heap> -jar fabric-server-launch.jar nogui` with cwd
   `<runDir>/server`, pipes logs to `<runDir>/logs/server.log`, polls `GET /meta`
   (5 min timeout), prints the map URL, and stays attached. `Ctrl+C` stops the child
   cleanly (`stop` on stdin, then SIGTERM, then SIGKILL).

Seeds are treated as **strings end-to-end** (signed 64-bit; JSON numbers lose precision
above 2^53). Text seeds are rejected — use the numeric value from `/seed` in-game.

### `seedmap verify-seed <runDir> --observations <file.json> --candidates <seed,...> [--port]`

POSTs `/seed/verify` to the running oracle and pretty-prints the per-candidate report.
**Exit code 0 only when exactly one candidate fully matches.** The observations file is
either a JSON array of observations or `{"observations": [...]}` (limits: ≤16 candidates,
≤256 observations, per the contract). `--port` defaults to the port recorded in
`config/seedmap-oracle.json`.

```json
[
  { "type": "biome", "dim": "minecraft:overworld", "x": 0, "y": 64, "z": 0, "expected": "minecraft:plains" },
  { "type": "structure", "dim": "minecraft:overworld", "x": 1424, "z": -368, "expected": "minecraft:village_plains" }
]
```

### `seedmap doctor [<runDir>] [--yes] [--no-download]`

- Java 21 discovery with per-install report (where found, version), Node version,
  free RAM (warns under 6 GB against the default `-Xmx4G` heap), free disk.
- When no Java 21+ exists: offers to download a **Temurin 21 JRE** from
  `api.adoptium.net` into `<seedmap home>/jre` — **prompts first**, `--yes` skips the
  prompt, `--no-download` only prints install instructions. The archive checksum
  (SHA-256) is verified. The seedmap home is `~/.seedmap` (override: `SEEDMAP_HOME`).
- With a run dir: `run.json` validity, missing-jar checks (server jar, Fabric launcher,
  oracle mod jar), EULA status.

## Overlays and the fingerprint

`--overlay <zip|dir>` mirrors the server layout (`config/`, `world/datapacks/`,
`server.properties`, …) and is applied **last**. Every overlay file is diffed against the
pre-overlay state; the drift (`[{path, kind: "added"|"replaced"}]`, identical files
omitted) is recorded in `run.json` and `config/seedmap-oracle.json`, and surfaces in the
oracle's `/meta`.

`packFingerprint` is computed exactly per [`docs/oracle-api.md`](../docs/oracle-api.md):
`"sha256:" + sha256` of the sorted lines `sha512(file) + "  " + relative-path + "\n"` for
every file under `mods/`, `config/`, `world/datapacks/` — **before** the overlay, with
`/` path separators on every platform (lines sorted lexicographically as strings).

## Run directory layout (provisioner-owned)

```
runs/<name>/
  run.json          # manifest: pack ref, pinned version, fingerprint, file hashes, overlayDiff
  pack.mrpack       # kept for cheap re-provisioning (Modrinth remote flow)
  mods-manual/      # manual drop-ins for CurseForge-blocked mods
  server/           # assembled headless server (mods/, config/, server.jar, fabric-server-launch.jar)
  cache/            # oracle tile cache root (cacheDir in seedmap-oracle.json)
  logs/server.log
```

`runs/` is gitignored — downloaded mod jars and the assembled server are never
redistributed.

## Design notes

- **Zip library: `yauzl`** (runtime) — chosen over `adm-zip` because it streams entries
  instead of buffering whole archives in memory (mrpacks and server packs can be
  hundreds of MB), validates entry metadata strictly, and is the most battle-tested
  reader in the ecosystem. Our extraction adds an explicit zip-slip guard on top
  (traversal/absolute/drive-letter entry names are rejected, and resolved targets must
  stay inside the destination). `yazl` (same author) is a **dev-only** dependency used
  to build zip fixtures in tests. `adm-zip` would have covered read+write with one
  dependency, but it buffers archives fully in memory and has a weaker safety record.
- **Testability**: pure core modules (`src/core/` — mrpack/manifest parsing, version
  selection, fingerprint, overlay diff, server.properties, EULA gate, seed and Java
  version parsing) are separated from IO shells (`src/io/`); all HTTP goes through an
  injected `FetchLike`. Tests never touch the network — fixtures are synthetic and zips
  are built in-test.
- Cross-platform: no hardcoded paths (`path.join` everywhere), Windows zip entry names
  (backslashes) normalized, `java.exe` handled, `tar` used only where the OS ships it
  (Adoptium serves zips on Windows).
