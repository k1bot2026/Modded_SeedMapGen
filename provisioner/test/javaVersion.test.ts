import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  javaCandidates,
  javaExecutableName,
  parseJavaVersionOutput,
  type JavaSearchEnv,
} from "../src/core/javaVersion.js";

describe("parseJavaVersionOutput", () => {
  it("parses Temurin 21 `java -version` (stderr style)", () => {
    const out = [
      'openjdk version "21.0.3" 2024-04-16 LTS',
      "OpenJDK Runtime Environment Temurin-21.0.3+9 (build 21.0.3+9-LTS)",
      "OpenJDK 64-Bit Server VM Temurin-21.0.3+9 (build 21.0.3+9-LTS, mixed mode)",
    ].join("\n");
    expect(parseJavaVersionOutput(out)).toEqual({ major: 21, version: "21.0.3" });
  });

  it("parses Oracle-style `java version`", () => {
    expect(parseJavaVersionOutput('java version "17.0.2" 2022-01-18 LTS')).toEqual({
      major: 17,
      version: "17.0.2",
    });
  });

  it("parses legacy 1.8 scheme as major 8", () => {
    expect(parseJavaVersionOutput('openjdk version "1.8.0_392"')).toEqual({
      major: 8,
      version: "1.8.0_392",
    });
  });

  it("parses the modern unquoted `java --version` style", () => {
    const out = "openjdk 21.0.3 2024-04-16 LTS\nOpenJDK Runtime Environment ...";
    expect(parseJavaVersionOutput(out)).toEqual({ major: 21, version: "21.0.3" });
  });

  it("parses an EA build with just a major", () => {
    expect(parseJavaVersionOutput('openjdk version "22" 2024-03-19')?.major).toBe(22);
  });

  it("returns null on garbage", () => {
    expect(parseJavaVersionOutput("command not found: java")).toBeNull();
    expect(parseJavaVersionOutput("")).toBeNull();
  });
});

describe("javaCandidates", () => {
  const base: JavaSearchEnv = {
    platform: "linux",
    homeDir: "/home/u",
    seedmapHome: "/home/u/.seedmap",
  };

  it("puts the seedmap-managed JRE first, then JAVA_HOME, then PATH", () => {
    const candidates = javaCandidates({ ...base, javaHome: "/opt/jdk" });
    expect(candidates[0]).toEqual({
      kind: "scan-dir",
      path: path.join("/home/u/.seedmap", "jre"),
      source: "seedmap-managed JRE",
    });
    expect(candidates[1]).toEqual({
      kind: "exe",
      path: path.join("/opt/jdk", "bin", "java"),
      source: "JAVA_HOME",
    });
    expect(candidates[2]).toEqual({ kind: "exe", path: "java", source: "PATH" });
  });

  it("skips JAVA_HOME when unset", () => {
    const candidates = javaCandidates(base);
    expect(candidates.some((c) => c.source === "JAVA_HOME")).toBe(false);
  });

  it("scans /usr/lib/jvm on linux", () => {
    const candidates = javaCandidates(base);
    expect(candidates.some((c) => c.kind === "scan-dir" && c.path === "/usr/lib/jvm")).toBe(true);
  });

  it("scans /Library JVMs on macOS and uses java.exe on Windows", () => {
    const mac = javaCandidates({ ...base, platform: "darwin" });
    expect(mac.some((c) => c.path === "/Library/Java/JavaVirtualMachines")).toBe(true);

    expect(javaExecutableName("win32")).toBe("java.exe");
    expect(javaExecutableName("linux")).toBe("java");
    const win = javaCandidates({ ...base, platform: "win32" });
    expect(win.some((c) => c.path.includes("Eclipse Adoptium"))).toBe(true);
  });
});
