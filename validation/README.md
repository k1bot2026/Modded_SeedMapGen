# @seedmap/validation

The correctness harness — this project's soul (CLAUDE.md §5). Every worldgen
answer the app shows comes from the oracle; this package is how we prove the
oracle agrees with itself, with the game's own `/locate` code path, and with a
committed vanilla baseline. **Milestone gates run here**: no milestone advances
while its gate fails.

Everything is a `validate` subcommand (TypeScript, cross-platform — there are
deliberately no `gates/*.sh` wrappers). All commands talk to a **running**
oracle over HTTP; nothing here boots servers.

```bash
pnpm --dir validation start -- locate --oracle http://127.0.0.1:8765
# or after install: validate locate
```

## Commands

### `validate locate [--oracle <url>] [--per-dim 200] [--seed-rng 42] [--level biome_ok|start_ok]`

Per dimension, draws N pseudo-random origins (seeded PRNG — the same
`--seed-rng` always tests the same points, so runs are reproducible). For every
structure type registered in that dimension (from `/registry/structures`), it
computes the nearest feature two independent ways:

1. **Ground truth**: `GET /locate` — the game's `ChunkGenerator#locateStructure`.
2. **Map layer**: an expanding-bbox search over `GET /structures/placed`
   (the same data the webapp renders as markers).

They must agree **100% on position**. `/locate` `not_found` counts as agreement
only when the placed-search also finds nothing within the same radius. Every
mismatch prints a full repro (dimension, origin, type, both answers, exact
`curl` commands). Non-zero exit on any mismatch.

**Radius/bbox strategy** (also documented in `src/core/nearest.ts`): a square
bbox of half-width `r` contains every point at distance ≤ `r`, so a nearest hit
at distance `d ≤ r` is provably the true nearest. A corner hit (`d > r`) is
settled by one more query at half-width `⌈d⌉`. Schedule 512 → 1280 → 2560
blocks; the 2560 cap covers vanilla `locateStructure`'s ±100-chunk square
(corner ≈ 2263 blocks) with margin, and stays under the contract's
512×512-chunk bbox limit, so each step is a single request.

### `validate self-consistency --run-a <url> --run-b <url> [--grids 20] [--tiles 40] [--bboxes 10] [--seed-rng 42]`

Two **independently provisioned + booted** oracles for the same pack version and
seed must be indistinguishable (guards nondeterminism and threading bugs):

- `/meta` identity fields (seed, fingerprint, versions, dimensions, mod list),
- `/registry/structures` and `/registry/biomes` (order-insensitive),
- K random `/biomes/grid` responses **byte-equal**,
- M random tile PNGs **hash-equal** (sha256),
- `/structures/placed` feature sets equal on random bboxes.

Stops at the first divergence and reports it precisely (endpoint, request
params, first differing byte / JSON path / both hashes). This command needs two
servers, so it is *not* part of `validate all` — run it explicitly.

### `validate vanilla-baseline [--oracle <url>] [--fixture fixtures/vanilla-1.21.1.json] [--record]`

Compares the oracle against the committed vanilla 1.21.1 fixture: biomes at
fixed coordinates (surface, cave depth, nether, end) and `/locate` answers for
villages (`#minecraft:village`), strongholds, a fortress and an end city, all
for the standard seed `1234`. This sanity-checks that the harness itself works
against known-good vanilla worldgen.

**The fixture ships `"status": "unpopulated"`** — it can only be recorded
against a booted server, which a sandbox cannot do. While unpopulated the
command prints the how-to and exits with code **2** (distinct from a real
failure): the gate stays honest instead of silently green.

#### Recording the fixture (owner, once per intended change)

```bash
# 1. Fresh vanilla 1.21.1 oracle with the standard seed:
seedmap provision vanilla --mc 1.21.1 --out runs/vanilla
seedmap run runs/vanilla --seed 1234 --accept-eula

# 2. Record (stamps recordedBy, recordedAt, and the oracle's /meta identity):
validate vanilla-baseline --record            # add --recorded-by you@host to override

# 3. Review the diff and commit fixtures/vanilla-1.21.1.json.
```

Populated schema (enforced by `src/core/fixture.ts`):

```json
{
  "status": "populated",
  "seed": "1234",
  "recordedBy": "owner@mac-mini",
  "recordedAt": "2026-07-16T12:00:00.000Z",
  "oracle": { "mcVersion": "1.21.1", "oracleModVersion": "0.1.0", "packFingerprint": "sha256:…" },
  "biomes":  [ { "dim": "minecraft:overworld", "x": 0, "y": 64, "z": 0, "expected": "minecraft:plains" } ],
  "locates": [ { "dim": "minecraft:overworld", "originX": 0, "originZ": 0,
                 "structure": "#minecraft:village", "expected": { "x": 100, "z": -200 } } ]
}
```

Comparison requires the oracle's seed and mcVersion to match the fixture
(fail-fast with boot instructions otherwise); a differing `packFingerprint` is
only noted — a rebuilt oracle mod must NOT change any worldgen answer, and
that is precisely what gets verified.

### `validate all [--oracle <url>]`

`locate` + `vanilla-baseline`. Self-consistency is excluded (needs two booted
oracles) and the output says so. Exit code: `1` on any failure, `2` if the only
problem is an unpopulated fixture.

## Milestone gates — `validate gate m0|m1|m2|m3`

Thin TS orchestrators (cross-platform; no shell scripts) that automate what CAN
be automated per CLAUDE.md. Each prints `[PASS]`/`[FAIL]` lines plus a
`RESULT:` verdict — paste the block into the milestone PR description. Exit
code 0 only when every check passes.

| Gate | CLAUDE.md milestone | Automated checks | Not automated here (why) |
| --- | --- | --- | --- |
| `m0` | **M0 — Scaffold** | `/meta` reachable; `mcVersion == "1.21.1"`; `seedmap-oracle` in `mods` | `./gradlew build` + boot are the provisioner/oracle-mod's own checks |
| `m1` | **M1 — Vanilla biomes** | `validate vanilla-baseline`; 5×5 tile viewport fetched twice — all PNG, second pass byte-identical **and** served from cache | headless-browser map screenshot lives in `webapp` e2e |
| `m2` | **M2 — Cobbleverse** | `/registry/biomes` has ≥1 `terralith:` id; committed fixture coordinate answers the recorded `terralith:` biome (`--record` populates `fixtures/terralith-m2.json` via a grid scan) | provisioning itself; owner's 10 in-game F3 spot-checks (manual QA, recorded in the PR) |
| `m3` | **M3 — Structures** | `validate locate` at 100%; `/registry/structures` has `cobbleverse:` ids | `cobbleverse:` marker render test lives in `webapp` e2e |

**m1 cache-hit detection**: the oracle does not send an `X-Cache` header yet, so
the gate uses a timing heuristic — second-pass median ≤ max(30 ms, half the
first-pass median) — and says so in a `note:` line. If the header is added
later the gate automatically prefers it (`hit` = cache hit). An already-warm
first pass (tiles cached by an earlier run) is noted, not failed.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | everything passed |
| 1 | validation failure (mismatch, divergence, failed gate check) |
| 2 | fixture unpopulated / unreadable, bad configuration |

## Design notes

- **Oracle client** (`src/oracle-client.ts`): typed by hand from
  `docs/oracle-api.md`. Seeds are strings end-to-end; a numeric seed in a
  response is rejected as a contract violation. 2xx bodies are structurally
  validated so drift fails loudly. `fetch` is injected — **no test in this
  package ever touches the network**; everything runs against canned responses.
- **Determinism**: all randomness flows from `--seed-rng` through a mulberry32
  PRNG; per-dimension streams are derived by label so adding a dimension never
  shifts another dimension's origins.
- Comparison/reporting logic is pure and unit-tested (`test/`): locate
  agreement incl. both-not-found, bbox expansion + cap behavior, byte/JSON
  first-divergence, fixture schema validation, cache heuristic, gate formatting.
