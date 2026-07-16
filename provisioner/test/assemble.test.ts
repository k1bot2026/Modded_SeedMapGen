import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yazl from "yazl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOverlay, computeServerFingerprint } from "../src/assemble.js";

let tmpDir: string;
let serverDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedmap-asm-"));
  serverDir = path.join(tmpDir, "server");
  await mkdir(path.join(serverDir, "mods"), { recursive: true });
  await mkdir(path.join(serverDir, "config"), { recursive: true });
  await writeFile(path.join(serverDir, "mods", "a.jar"), "jar-a");
  await writeFile(path.join(serverDir, "config", "a.toml"), "conf-a");
  await writeFile(path.join(serverDir, "server.properties"), "motd=x\n"); // not fingerprinted
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("computeServerFingerprint", () => {
  it("only covers mods/, config/, world/datapacks/ and is stable", async () => {
    const first = await computeServerFingerprint(serverDir);
    expect(first.files.map((f) => f.path).sort()).toEqual(["config/a.toml", "mods/a.jar"]);
    // server.properties changes must not affect the fingerprint.
    await writeFile(path.join(serverDir, "server.properties"), "motd=changed\n");
    const second = await computeServerFingerprint(serverDir);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("changes when a mod changes", async () => {
    const before = await computeServerFingerprint(serverDir);
    await writeFile(path.join(serverDir, "mods", "a.jar"), "jar-a-modified");
    const after = await computeServerFingerprint(serverDir);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});

describe("applyOverlay", () => {
  it("applies a directory overlay and reports drift (added/replaced, identical omitted)", async () => {
    const overlayDir = path.join(tmpDir, "overlay");
    await mkdir(path.join(overlayDir, "config"), { recursive: true });
    await writeFile(path.join(overlayDir, "config", "a.toml"), "conf-a-tweaked"); // replaced
    await writeFile(path.join(overlayDir, "config", "extra.json"), "{}"); // added
    await writeFile(path.join(overlayDir, "server.properties"), "motd=x\n"); // identical -> omitted

    const diff = await applyOverlay(serverDir, overlayDir);
    expect(diff).toEqual([
      { path: "config/a.toml", kind: "replaced" },
      { path: "config/extra.json", kind: "added" },
    ]);
    expect(await readFile(path.join(serverDir, "config", "a.toml"), "utf8")).toBe("conf-a-tweaked");
  });

  it("applies a zip overlay identically", async () => {
    const zipPath = path.join(tmpDir, "overlay.zip");
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from("conf-a-zip"), "config/a.toml");
    zip.addBuffer(Buffer.from("dp"), "world/datapacks/extra.zip");
    zip.end();
    await new Promise<void>((resolve, reject) => {
      zip.outputStream.pipe(createWriteStream(zipPath)).on("close", resolve).on("error", reject);
    });

    const diff = await applyOverlay(serverDir, zipPath);
    expect(diff).toEqual([
      { path: "config/a.toml", kind: "replaced" },
      { path: "world/datapacks/extra.zip", kind: "added" },
    ]);
    expect(await readFile(path.join(serverDir, "config", "a.toml"), "utf8")).toBe("conf-a-zip");
  });

  it("fingerprint excludes overlay drift: compute before, overlay after", async () => {
    const before = await computeServerFingerprint(serverDir);
    const overlayDir = path.join(tmpDir, "overlay2");
    await mkdir(path.join(overlayDir, "config"), { recursive: true });
    await writeFile(path.join(overlayDir, "config", "a.toml"), "overlaid");
    await applyOverlay(serverDir, overlayDir);
    // The provisioner records `before` (pre-overlay) as THE fingerprint;
    // recomputing now differs, which is exactly why order matters.
    const after = await computeServerFingerprint(serverDir);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});
