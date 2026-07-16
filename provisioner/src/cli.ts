#!/usr/bin/env node
import { Command } from "commander";
import { UserError } from "./errors.js";
import { defaultFetch } from "./io/fetcher.js";
import { consoleLog } from "./util.js";
import { provisionModrinth } from "./commands/provisionModrinth.js";
import { provisionCurseforge } from "./commands/provisionCurseforge.js";
import { provisionVanilla } from "./commands/provisionVanilla.js";
import { provisionLocal } from "./commands/provisionLocal.js";
import { runCommand } from "./commands/run.js";
import { verifySeedCommand } from "./commands/verifySeed.js";
import { doctorCommand } from "./commands/doctor.js";
import { PINS } from "./pins.js";

const program = new Command();
const fetchImpl = defaultFetch();
const log = consoleLog;

program
  .name("seedmap")
  .description(
    "Modpack Seedmap provisioner: turn a Fabric 1.21.1 pack reference into a running,\n" +
      "localhost-only worldgen oracle. See CLAUDE.md / docs/oracle-api.md in the repo.",
  )
  .version("0.1.0");

const provision = program
  .command("provision")
  .description("Assemble a headless oracle server from a pack reference");

provision
  .command("modrinth")
  .description("Provision from Modrinth (PRIMARY): slug, project URL, or local .mrpack file")
  .argument("<ref>", "Modrinth slug, modrinth.com URL, or path to a .mrpack file")
  .option("--version <v>", "exact version id or version number (omit to list versions)")
  .option("--overlay <zipOrDir>", "server-layout overlay applied last (config tweaks etc.)")
  .option("--out <dir>", "run directory (default runs/<slug>-<version>)")
  .option("--oracle-jar <jar>", "path to the built oracle mod jar")
  .action(async (ref: string, opts: Record<string, string | undefined>) => {
    const provisioned = await provisionModrinth(
      ref,
      {
        ...(opts.version !== undefined ? { version: opts.version } : {}),
        ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
        ...(opts.out !== undefined ? { out: opts.out } : {}),
        ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
      },
      fetchImpl,
      log,
    );
    if (!provisioned) process.exitCode = 1; // listed versions; user must pick one
  });

provision
  .command("curseforge")
  .description("Provision from a CurseForge pack zip or server-pack zip (needs CURSEFORGE_API_KEY)")
  .argument("<zip>", "path to a CurseForge modpack zip or server pack zip")
  .option("--overlay <zipOrDir>", "server-layout overlay applied last")
  .option("--out <dir>", "run directory (default runs/<pack>-<version>)")
  .option("--oracle-jar <jar>", "path to the built oracle mod jar")
  .action(async (zip: string, opts: Record<string, string | undefined>) => {
    await provisionCurseforge(
      zip,
      {
        ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
        ...(opts.out !== undefined ? { out: opts.out } : {}),
        ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
      },
      fetchImpl,
      log,
    );
  });

provision
  .command("vanilla")
  .description("Provision vanilla + oracle only (no pack) — M0 smoke test")
  .option("--mc <version>", "Minecraft version", PINS.minecraft)
  .option("--out <dir>", "run directory (default runs/vanilla-<mc>)")
  .option("--oracle-jar <jar>", "path to the built oracle mod jar")
  .action(async (opts: Record<string, string | undefined>) => {
    await provisionVanilla(
      {
        mc: opts.mc ?? PINS.minecraft,
        ...(opts.out !== undefined ? { out: opts.out } : {}),
        ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
      },
      fetchImpl,
      log,
    );
  });

provision
  .command("local")
  .description("Provision from a local server directory (copies mods/config/datapacks, never world data)")
  .argument("<serverDir>", "existing server directory")
  .option("--overlay <zipOrDir>", "server-layout overlay applied last")
  .option("--out <dir>", "run directory (default runs/local-<name>)")
  .option("--oracle-jar <jar>", "path to the built oracle mod jar")
  .action(async (serverDir: string, opts: Record<string, string | undefined>) => {
    await provisionLocal(
      serverDir,
      {
        ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
        ...(opts.out !== undefined ? { out: opts.out } : {}),
        ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
      },
      fetchImpl,
      log,
    );
  });

program
  .command("run")
  .description("Boot the oracle server for a seed and stay attached (Ctrl+C stops it cleanly)")
  .argument("<runDir>", "provisioned run directory (contains run.json)")
  .option("--seed <seed>", "world seed (64-bit; from /seed in-game)")
  .option("--port <port>", "oracle HTTP port", "8765")
  .option("--heap <heap>", "JVM max heap, e.g. 4G or 2048M", "4G")
  .option("--accept-eula", "accept the Minecraft EULA (https://aka.ms/MinecraftEULA)")
  .option("--dim <dim...>", "advisory dimension filter recorded in seedmap-oracle.json")
  .option("--oracle-jar <jar>", "path to the built oracle mod jar (if re-injection is needed)")
  .action(async (runDir: string, opts: Record<string, unknown>) => {
    await runCommand(
      runDir,
      {
        ...(typeof opts.seed === "string" ? { seed: opts.seed } : {}),
        ...(typeof opts.port === "string" ? { port: opts.port } : {}),
        ...(typeof opts.heap === "string" ? { heap: opts.heap } : {}),
        ...(opts.acceptEula === true ? { acceptEula: true } : {}),
        ...(Array.isArray(opts.dim) ? { dim: opts.dim as string[] } : {}),
        ...(typeof opts.oracleJar === "string" ? { oracleJar: opts.oracleJar } : {}),
      },
      fetchImpl,
      log,
    );
  });

program
  .command("verify-seed")
  .description("POST observations to the running oracle; exit 0 only if exactly one candidate matches")
  .argument("<runDir>", "provisioned run directory")
  .requiredOption("--observations <file.json>", "JSON observations file")
  .requiredOption("--candidates <seeds>", "comma-separated candidate seeds (max 16)")
  .option("--port <port>", "oracle HTTP port (default: from seedmap-oracle.json, else 8765)")
  .action(async (runDir: string, opts: Record<string, string | undefined>) => {
    process.exitCode = await verifySeedCommand(
      runDir,
      {
        observations: opts.observations!,
        candidates: opts.candidates!,
        ...(opts.port !== undefined ? { port: opts.port } : {}),
      },
      fetchImpl,
      log,
    );
  });

program
  .command("doctor")
  .description("Check Java 21, Node, RAM, disk — optionally auto-install a Temurin 21 JRE")
  .argument("[runDir]", "also check a provisioned run directory (eula, missing jars)")
  .option("--yes", "skip the JRE download confirmation prompt")
  .option("--no-download", "never download a JRE; print install instructions instead")
  .action(async (runDir: string | undefined, opts: Record<string, unknown>) => {
    process.exitCode = await doctorCommand(
      runDir,
      {
        ...(opts.yes === true ? { yes: true } : {}),
        download: opts.download !== false,
      },
      fetchImpl,
      log,
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof UserError) {
    console.error(`\nseedmap: ${err.message}`);
    process.exitCode = err.exitCode;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
});
