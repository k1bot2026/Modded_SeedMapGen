# seedmap

## Doel
Seedmap tekent volledig correcte seed maps (biomen en structuren, alle dimensies) voor modded Minecraft 1.21.1 op Fabric, met als eerste doel de Cobbleverse-server van de eigenaar. Bestaande seed maps herimplementeren de worldgen en zitten daardoor fout zodra mods als Terralith of Cobbleverse meedoen. Seedmap vraagt daarom alles aan de echte worldgenerator van een headless server met exact dezelfde pack-versie (de "Oracle-regel": als de game het kan beantwoorden, vraag het de game). Het is een lokale tool voor één gebruiker, die alleen een pack-referentie, een vastgepinde versie en een seed opgeeft. Er is geen Minecraft-installatie, account of verbinding met de echte server nodig.

## Architectuur in hoofdlijnen
- `oracle-mod/` (Java 21, Fabric Loom, Yarn): server-side mod met een HTTP-server die alleen op 127.0.0.1 luistert en alleen leest. Het is het enige onderdeel dat worldgen-antwoorden geeft. De mod laadt of genereert nooit chunks in een echte wereld, want de kaart moet een voorspelling zijn en mag de productiewereld nooit raken. Het contract staat in `docs/oracle-api.md`; de Yarn-symbolen zijn met bronnen vastgelegd in `oracle-mod/VERIFICATION.md`, omdat namen uit het geheugen bij Minecraft-internals vaak fout zijn.
- `provisioner/` (TypeScript-CLI `seedmap`): zet een pack-referentie (Modrinth als hoofdroute, CurseForge, lokaal) om in een draaiende Oracle. De CLI downloadt de Mojang-serverjar, de Fabric-loader en de packbestanden zelf en controleert hashes. Versies worden nooit stilzwijgend op "latest" gezet, want correctheid hangt af van exact de versie waarmee de wereld is gemaakt. De EULA wordt alleen geaccepteerd met een expliciete vlag.
- `webapp/` (Vite, TypeScript, MapLibre GL): een slippy map bovenop de tiles en endpoints van de Oracle. De banner toont pack, versie, fingerprint en seed, zodat altijd duidelijk is wélke voorspelling je bekijkt.
- `validation/` (TypeScript-CLI `validate`): de correctheidsharnas met locate-overeenstemming, self-consistency en vanilla-baseline, plus de milestonegates M0–M5. Correctheid is het product, dus elke milestone heeft een machinaal controleerbare gate.
- `runs/` wordt gegenereerd en nooit gecommit: mod-jars mogen niet worden herverdeeld.
- De TypeScript-pakketten zijn pnpm-workspaces. Tests raken nooit het netwerk: HTTP loopt via een geïnjecteerde `FetchLike`.

De volledige oorspronkelijke specificatie (componenten, non-goals, milestones M0–M5 met gates) stond in `CLAUDE.md` tot en met commit `d037ee9` en is daar nog op te halen met `git show d037ee9:CLAUDE.md`.

## Kwaliteitsnormen
- Coveragedrempel: 40
- De drempel is een voorzichtige schatting en nog niet gemeten: er is nog geen coverage-tooling. `webapp/src/main.ts` en `webapp/src/ui/` hebben geen unittests, de `core`-modules wel. Verhoog de drempel pas na een gemeten run.
- TypeScript strict in alle pakketten (`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); `npm run typecheck` moet foutloos zijn.
- ESLint 9 met `typescript-eslint` `recommendedTypeChecked` per pakket; `npm run lint` moet foutloos zijn.
- Vitest-unittests per pakket, zonder netwerktoegang.
- `oracle-mod` moet bouwen met `./gradlew build` (`pnpm check:oracle-mod`). Dit valt buiten `scripts/verify.sh`. Elke nieuw gebruikt Minecraft- of Fabric-symbool krijgt een bronvermelding in `oracle-mod/VERIFICATION.md`.
- Cross-platform (macOS, Windows, Linux): geen hardgecodeerde platformpaden.
- Conventional Commits, afgedwongen met commitlint.

## Allowlist van dependencies
### Runtime
- commander: argumentparser voor de CLI's `seedmap` en `validate`
- yauzl: lezen van `.mrpack`- en CurseForge-zips in de provisioner
- maplibre-gl: renderen van de slippy map in de webapp
### Development
- typescript: compiler en typecheck
- eslint: linter
- @eslint/js: basisregels voor eslint
- typescript-eslint: type-aware lintregels
- globals: browser- en node-globals voor de eslint-config van de webapp
- vitest: unittestrunner
- @vitest/coverage-v8: coverage voor `npm test -- --coverage` in `scripts/verify.sh`
- @types/node: Node-typen
- @types/yauzl: typen voor yauzl
- @types/yazl: typen voor yazl
- yazl: zip-fixtures bouwen in provisionertests
- @types/geojson: GeoJSON-typen voor de markerlagen
- vite: dev-server en build van de webapp
- @playwright/test: e2e-test van de kaart tegen de mock-oracle
- @commitlint/cli: commitlint voor lefthook en `scripts/verify.sh`
- @commitlint/config-conventional: Conventional Commits-regelset voor `commitlint.config.js`
- lefthook: git-hooks uit `lefthook.yml`

## Toegestane netwerkdomeinen
- registry.npmjs.org
- maven.fabricmc.net
- repo.maven.apache.org
- plugins.gradle.org
- plugins-artifacts.gradle.org
- services.gradle.org
- libraries.minecraft.net
- piston-meta.mojang.com
- piston-data.mojang.com

## Epics
- E1 Pipeline-gereed (open): `scripts/verify.sh` slaagt op een schone checkout, en de projectspecificatie is na de pipeline-installatie nog vindbaar in `docs/`.
- E2 Correctheidsgates M0–M5 (open): elke milestonegate uit de specificatie is als commando reproduceerbaar en groen, met de uitkomst vastgelegd.
