import { describe, expect, it } from "vitest";
import { eulaFileContent, isEulaAccepted, resolveEula } from "../src/core/eula.js";

describe("resolveEula (the gate)", () => {
  it("refuses without --accept-eula and no prior acceptance", () => {
    expect(resolveEula(null, false)).toEqual({ accepted: false, write: false });
  });

  it("refuses when eula.txt exists but says false", () => {
    expect(resolveEula("eula=false\n", false)).toEqual({ accepted: false, write: false });
  });

  it("NEVER writes eula.txt without the flag", () => {
    expect(resolveEula(null, false).write).toBe(false);
    expect(resolveEula("eula=true\n", false).write).toBe(false);
  });

  it("accepts with --accept-eula and writes the file", () => {
    expect(resolveEula(null, true)).toEqual({ accepted: true, write: true });
  });

  it("honors a previously recorded acceptance without rewriting", () => {
    expect(resolveEula("# accepted earlier\neula=true\n", false)).toEqual({
      accepted: true,
      write: false,
    });
  });
});

describe("isEulaAccepted", () => {
  it("parses comments, whitespace, and case", () => {
    expect(isEulaAccepted("#comment\n  eula = TRUE  \n")).toBe(true);
    expect(isEulaAccepted("# eula=true\n")).toBe(false); // commented out
    expect(isEulaAccepted("")).toBe(false);
    expect(isEulaAccepted(null)).toBe(false);
    expect(isEulaAccepted("eula=truely\n")).toBe(false);
  });
});

describe("eulaFileContent", () => {
  it("records the acceptance flag and links the EULA", () => {
    const content = eulaFileContent(new Date("2026-01-02T03:04:05Z"));
    expect(content).toContain("eula=true");
    expect(content).toContain("2026-01-02T03:04:05");
    expect(content).toContain("aka.ms/MinecraftEULA");
  });
});
