import path from "node:path";

export interface JavaVersionInfo {
  /** Feature release, e.g. 21 for "21.0.3", 8 for "1.8.0_392". */
  major: number;
  /** Full version string as printed. */
  version: string;
}

/**
 * Parse the output of `java -version` / `java --version`. Handles both the
 * quoted legacy form (`openjdk version "21.0.3" 2024-04-16`) and the modern
 * unquoted form (`openjdk 21.0.3 2024-04-16 LTS`). Returns null when no
 * version can be found.
 */
export function parseJavaVersionOutput(output: string): JavaVersionInfo | null {
  const quoted = /(?:openjdk|java)\s+version\s+"([^"]+)"/i.exec(output);
  const unquoted = /^\s*(?:openjdk|java)\s+((?:[0-9]+)(?:\.[0-9][^\s]*)?)/im.exec(output);
  const version = quoted?.[1] ?? unquoted?.[1];
  if (version === undefined) return null;

  const parts = version.split(".");
  let major = Number.parseInt(parts[0] ?? "", 10);
  if (major === 1 && parts.length > 1) {
    // Legacy scheme: 1.8.0_392 -> 8
    major = Number.parseInt(parts[1] ?? "", 10);
  }
  if (!Number.isFinite(major)) return null;
  return { major, version };
}

export interface JavaSearchEnv {
  platform: NodeJS.Platform;
  homeDir: string;
  /** Root dir for seedmap-owned files (auto-downloaded JRE lives at <seedmapHome>/jre). */
  seedmapHome: string;
  javaHome?: string;
}

export function javaExecutableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "java.exe" : "java";
}

export interface JavaCandidate {
  /** Either an exact java executable path, or a directory to scan one level deep for installs. */
  kind: "exe" | "scan-dir";
  path: string;
  source: string;
}

/**
 * Ordered discovery candidates: the seedmap-managed JRE, JAVA_HOME, PATH
 * (represented by the bare executable name), then common per-OS install roots.
 * Pure: the IO shell checks existence and runs `-version`.
 */
export function javaCandidates(env: JavaSearchEnv): JavaCandidate[] {
  const exe = javaExecutableName(env.platform);
  const candidates: JavaCandidate[] = [];

  candidates.push({
    kind: "scan-dir",
    path: path.join(env.seedmapHome, "jre"),
    source: "seedmap-managed JRE",
  });
  if (env.javaHome !== undefined && env.javaHome !== "") {
    candidates.push({ kind: "exe", path: path.join(env.javaHome, "bin", exe), source: "JAVA_HOME" });
  }
  candidates.push({ kind: "exe", path: exe, source: "PATH" });

  if (env.platform === "darwin") {
    candidates.push({
      kind: "scan-dir",
      path: "/Library/Java/JavaVirtualMachines",
      source: "system JVM directory",
    });
  } else if (env.platform === "win32") {
    const roots = [
      process.env.ProgramFiles ?? "C:\\Program Files",
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    ];
    for (const root of roots) {
      for (const vendor of ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto"]) {
        candidates.push({ kind: "scan-dir", path: path.join(root, vendor), source: `install dir (${vendor})` });
      }
    }
  } else {
    candidates.push({ kind: "scan-dir", path: "/usr/lib/jvm", source: "system JVM directory" });
    candidates.push({ kind: "scan-dir", path: "/usr/java", source: "system JVM directory" });
    candidates.push({
      kind: "scan-dir",
      path: path.join(env.homeDir, ".sdkman", "candidates", "java"),
      source: "sdkman",
    });
  }
  return candidates;
}
