/** PASS/FAIL line + gate report formatting, suitable for pasting into a PR description. */

export interface CheckLine {
  ok: boolean;
  label: string;
  detail?: string | undefined;
}

export function formatCheckLine(check: CheckLine): string {
  const tag = check.ok ? "[PASS]" : "[FAIL]";
  return check.detail !== undefined && check.detail !== ""
    ? `${tag} ${check.label} — ${check.detail}`
    : `${tag} ${check.label}`;
}

export interface GateReport {
  /** "m0" .. "m3" */
  gate: string;
  title: string;
  checks: CheckLine[];
  notes: string[];
}

export function gatePassed(report: GateReport): boolean {
  return report.checks.length > 0 && report.checks.every((c) => c.ok);
}

export function formatGateReport(report: GateReport): string {
  const lines: string[] = [];
  lines.push(`=== validate gate ${report.gate} — ${report.title} ===`);
  for (const check of report.checks) lines.push(formatCheckLine(check));
  for (const note of report.notes) lines.push(`note: ${note}`);
  const passed = report.checks.filter((c) => c.ok).length;
  lines.push(`RESULT: ${gatePassed(report) ? "PASS" : "FAIL"} (${passed}/${report.checks.length} checks)`);
  return lines.join("\n");
}

export type Logger = (line: string) => void;
