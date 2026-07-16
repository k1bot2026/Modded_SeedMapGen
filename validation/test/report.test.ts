import { describe, expect, it } from "vitest";
import { formatCheckLine, formatGateReport, gatePassed } from "../src/report.js";

describe("formatCheckLine", () => {
  it("renders PASS/FAIL with an optional detail", () => {
    expect(formatCheckLine({ ok: true, label: "mcVersion is 1.21.1" })).toBe("[PASS] mcVersion is 1.21.1");
    expect(formatCheckLine({ ok: false, label: "mod listed", detail: "mods present: fabric-api" })).toBe(
      "[FAIL] mod listed — mods present: fabric-api",
    );
  });
});

describe("formatGateReport / gatePassed", () => {
  const report = {
    gate: "m0",
    title: "Scaffold (CLAUDE.md M0)",
    checks: [
      { ok: true, label: "oracle /meta reachable" },
      { ok: false, label: 'mcVersion == "1.21.1"', detail: 'got "1.20.4"' },
    ],
    notes: ["run against runs/vanilla"],
  };

  it("fails when any check fails and counts checks", () => {
    expect(gatePassed(report)).toBe(false);
    const text = formatGateReport(report);
    expect(text).toContain("=== validate gate m0 — Scaffold (CLAUDE.md M0) ===");
    expect(text).toContain("[PASS] oracle /meta reachable");
    expect(text).toContain('[FAIL] mcVersion == "1.21.1" — got "1.20.4"');
    expect(text).toContain("note: run against runs/vanilla");
    expect(text).toContain("RESULT: FAIL (1/2 checks)");
  });

  it("passes only when every check passes and at least one ran", () => {
    expect(gatePassed({ ...report, checks: report.checks.map((c) => ({ ...c, ok: true })) })).toBe(true);
    expect(gatePassed({ ...report, checks: [] })).toBe(false);
  });
});
