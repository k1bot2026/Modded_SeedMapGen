# Modpack Seedmap (Oracle)

Fully correct seed maps for **modded Minecraft** — biomes and structures, all dimensions —
answered by the *real* world generator of a headless Fabric server (the **Oracle**),
never by a reimplementation. See [`CLAUDE.md`](CLAUDE.md) for the full spec and
[`docs/oracle-api.md`](docs/oracle-api.md) for the HTTP API contract.

> **The Oracle rule:** if a value can be asked from the game, ask the game.

Primary target: Cobbleverse (Minecraft **1.21.1, Fabric**), but any Fabric 1.21.1 pack works.
Packs are ingested from **Modrinth** (primary) or **CurseForge** (secondary). Standalone:
no Minecraft installation, launcher, or account needed — the provisioner downloads the
official Mojang server jar, Fabric loader, and pack files itself.

## Repository layout

| Package | What it is |
| --- | --- |
| [`oracle-mod/`](oracle-mod/) | Fabric server-side mod (Java 21, Loom, Yarn). Embeds a localhost-only HTTP server exposing read-only worldgen queries: `/meta`, `/biome`, `/biomes/grid`, `/tiles/**`, `/structures/*`, `/locate`, `/registry/*`, `/seed/verify`. |
| [`provisioner/`](provisioner/) | TypeScript CLI (`seedmap`): pack ingestion (Modrinth/CurseForge/local) → headless server assembly → lifecycle (`run`, `doctor`, `verify-seed`). |
| [`webapp/`](webapp/) | Vite + TypeScript + MapLibre GL slippy map: biome tiles, structure markers grouped by namespace, dimension switcher, search, shareable URLs. |
| [`validation/`](validation/) | Correctness harness: `validate locate`, `validate self-consistency`, `validate vanilla-baseline`. Milestone gates live here. |
| `runs/` | Generated (gitignored): assembled servers, tile caches, logs. |

## Prerequisites

- **Node 22+** and **pnpm 9+** (`corepack enable`)
- **Java 21** (`seedmap doctor` finds it, or offers a Temurin 21 auto-install)
- ~4 GB free RAM for a heavy pack, a few GB disk per provisioned run
- macOS / Windows / Linux; no GPU, no Minecraft account

## Quickstart

```bash
pnpm install
pnpm check                      # lint + typecheck + test + build (TS packages)

# Build the oracle mod (needs network access to maven.fabricmc.net + Mojang)
cd oracle-mod && ./gradlew build && cd ..

# M0 smoke: vanilla 1.21.1 with the oracle
pnpm --dir provisioner start -- provision vanilla --mc 1.21.1 --out runs/vanilla
pnpm --dir provisioner start -- run runs/vanilla --seed 1234 --accept-eula
curl http://127.0.0.1:8765/meta

# Cobbleverse (pin the version your world was created with!)
pnpm --dir provisioner start -- provision modrinth cobbleverse --version <pinned> --out runs/cobbleverse
pnpm --dir provisioner start -- run runs/cobbleverse --seed <your /seed value> --accept-eula

# Map UI
pnpm --dir webapp dev           # http://localhost:5173, talks to the oracle on :8765
```

`--accept-eula` is an explicit acknowledgement of the [Minecraft EULA](https://aka.ms/MinecraftEULA);
`eula.txt` is never written without it.

## Correctness stance

Every map is a **prediction for one specific pack version + seed** — the banner in the UI
shows pack name, pinned version, fingerprint, and seed. Version selection is always
explicit; "latest" is never resolved silently. The oracle:

- binds `127.0.0.1` only, `online-mode=false`, fresh throwaway world (`level-name=world-oracle`);
- is **read-only**: biome answers come from the seeded noise sampler at quart resolution
  (never `World#getBiome`), structure answers from the game's own placement calculator and
  `locateStructure` — no endpoint loads or generates chunks in any persistent world;
- never touches a production `world/`.

## Development notes

- Toolchain pins (verified against FabricMC sources): Minecraft `1.21.1`,
  Yarn `1.21.1+build.1`, Fabric Loader `0.16.14`, Fabric API `0.116.14+1.21.1`,
  Loom `1.6.11`, Gradle `8.7` (wrapper).
- TypeScript strict everywhere; conventional commits; each milestone lands as a PR with
  its validation-gate output pasted in the description.
- `runs/` is never committed (mod jars must not be redistributed).

### Defaults adopted for the spec's open questions (owner: please confirm)

1. **`doctor` Java auto-install**: prompts before downloading a Temurin 21 JRE into the
   app directory; `--yes` skips the prompt; `--no-download` prints instructions only.
2. **Heap**: default `-Xmx4G`, overridable with `seedmap run --heap <e.g. 2G>`; `doctor`
   warns when the machine has < 6 GB free RAM.

## Milestones

M0 scaffold → M1 vanilla biomes → M2 Cobbleverse via Modrinth → M3 structures →
M4 CurseForge + overlays → M5 seed-verify + polish. Machine-checkable gates per
milestone are defined in [`CLAUDE.md`](CLAUDE.md) and implemented in [`validation/`](validation/).
