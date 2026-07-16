/** Verified toolchain pins — see CLAUDE.md; do not bump casually. */
export const PINS = {
  minecraft: "1.21.1",
  fabricLoader: "0.16.14",
  fabricInstaller: "1.0.1",
  fabricApi: "0.116.14+1.21.1",
} as const;

export const USER_AGENT = "modpack-seedmap/0.1.0 (github.com/k1bot2026/Modded_SeedMapGen)";

export const DEFAULT_ORACLE_PORT = 8765;
export const DEFAULT_HEAP = "4G";

export const MODRINTH_API = "https://api.modrinth.com/v2";
export const CURSEFORGE_API = "https://api.curseforge.com";
export const MOJANG_VERSION_MANIFEST =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export const FABRIC_META = "https://meta.fabricmc.net/v2";
export const ADOPTIUM_API = "https://api.adoptium.net";

/** Names of the launcher pieces inside <runDir>/server. */
export const SERVER_JAR = "server.jar";
export const FABRIC_LAUNCH_JAR = "fabric-server-launch.jar";
export const FABRIC_LAUNCHER_PROPERTIES = "fabric-server-launcher.properties";

export const ORACLE_WORLD_NAME = "world-oracle";
