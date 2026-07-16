/**
 * Programmatic surface of @seedmap/provisioner. The CLI (src/cli.ts) is a thin
 * commander wrapper over these; the validation harness reuses the pure core.
 */
export { UserError, HashMismatchError } from "./errors.js";
export * from "./pins.js";

export { normalizeRelPath, isSafeRelPath } from "./core/paths.js";
export { parseSeed, parseSeedList } from "./core/seed.js";
export { computeFingerprint, isFingerprintPath, FINGERPRINT_ROOTS } from "./core/fingerprint.js";
export type { FingerprintFile } from "./core/fingerprint.js";
export { parseMrpackIndex } from "./core/mrpack.js";
export type { ParsedMrpack, MrpackFile, EnvSupport } from "./core/mrpack.js";
export { selectVersion, pickMrpackFile } from "./core/versionSelect.js";
export type { ModrinthVersion, VersionChoice } from "./core/versionSelect.js";
export { parseCfManifest, detectCurseforgeZipKind } from "./core/cfManifest.js";
export type { CfManifest, CfManifestFile, CfZipKind } from "./core/cfManifest.js";
export {
  parseServerProperties,
  mergeServerProperties,
  oracleServerProperties,
} from "./core/serverProperties.js";
export { computeOverlayDiff } from "./core/overlay.js";
export type { OverlayDiffEntry, OverlayKind, OverlayFileHash } from "./core/overlay.js";
export { resolveEula, isEulaAccepted, eulaFileContent, EULA_REFUSAL_MESSAGE } from "./core/eula.js";
export { parseJavaVersionOutput, javaCandidates, javaExecutableName } from "./core/javaVersion.js";
export type { JavaVersionInfo, JavaSearchEnv, JavaCandidate } from "./core/javaVersion.js";
export { parseRunManifest } from "./core/runManifest.js";
export type { RunManifest, PackSource } from "./core/runManifest.js";
export { buildOracleConfig } from "./core/oracleConfig.js";
export type { OracleConfig } from "./core/oracleConfig.js";

export { defaultFetch, fetchJson, downloadToFile } from "./io/fetcher.js";
export type { FetchLike, ExpectedHashes, DownloadResult } from "./io/fetcher.js";
export { hashFile, hashBuffer } from "./io/hash.js";
export { listZipEntries, readZipEntry, extractZipSubtree } from "./io/zip.js";
export { walkFiles, copyTree, pathExists, readTextIfExists, ensureDir } from "./io/fsx.js";
export { ModrinthClient, parseModrinthRef } from "./io/modrinth.js";
export { CurseforgeClient, requireCurseforgeApiKey } from "./io/curseforge.js";
export { resolveMojangServerJar } from "./io/mojang.js";
export { fabricServerLauncherUrl } from "./io/fabric.js";
export { discoverJava, findJava, probeJava, seedmapHome } from "./io/java.js";
export { parseObservationsFile } from "./commands/verifySeed.js";
export {
  computeServerFingerprint,
  applyOverlay,
  findOracleJar,
  runDirs,
} from "./assemble.js";
