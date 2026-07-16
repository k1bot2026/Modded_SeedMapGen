/** True when an existing eula.txt body accepts the EULA. */
export function isEulaAccepted(existing: string | null): boolean {
  if (existing === null) return false;
  for (const rawLine of existing.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    if (line.slice(0, eq).trim() === "eula") {
      return line.slice(eq + 1).trim().toLowerCase() === "true";
    }
  }
  return false;
}

export interface EulaResolution {
  accepted: boolean;
  /** Write a fresh eula.txt (only ever true when the user passed --accept-eula). */
  write: boolean;
}

/**
 * eula.txt is ONLY written after an explicit --accept-eula. A previous
 * acceptance recorded on disk keeps counting; nothing else does.
 */
export function resolveEula(existing: string | null, acceptFlag: boolean): EulaResolution {
  if (acceptFlag) return { accepted: true, write: true };
  return { accepted: isEulaAccepted(existing), write: false };
}

export function eulaFileContent(now: Date): string {
  return (
    `# Accepted via \`seedmap run --accept-eula\` on ${now.toISOString()}\n` +
    `# By setting eula=true you agree to the Minecraft EULA (https://aka.ms/MinecraftEULA).\n` +
    `eula=true\n`
  );
}

export const EULA_REFUSAL_MESSAGE =
  "eula.txt not accepted. Running a Minecraft server requires agreeing to the Minecraft EULA\n" +
  "(https://aka.ms/MinecraftEULA). Re-run with --accept-eula to record your agreement;\n" +
  "seedmap never writes eula.txt without it.";
