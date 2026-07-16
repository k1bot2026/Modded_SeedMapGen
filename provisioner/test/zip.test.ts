import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yazl from "yazl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "../src/io/fsx.js";
import { extractZipSubtree, listZipEntries, readZipEntry } from "../src/io/zip.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedmap-zip-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Build a zip fixture in-test (yazl is dev-only; runtime extraction uses yauzl). */
async function buildZip(zipPath: string, entries: Record<string, string>): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(content, "utf8"), name);
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(zipPath)).on("close", resolve).on("error", reject);
  });
}

describe("zip helpers", () => {
  it("lists entries and reads a single entry", async () => {
    const zipPath = path.join(tmpDir, "a.zip");
    await buildZip(zipPath, { "modrinth.index.json": '{"x":1}', "overrides/config/a.toml": "a" });
    const names = await listZipEntries(zipPath);
    expect(names).toContain("modrinth.index.json");
    expect(names).toContain("overrides/config/a.toml");

    const buf = await readZipEntry(zipPath, "modrinth.index.json");
    expect(buf?.toString("utf8")).toBe('{"x":1}');
    expect(await readZipEntry(zipPath, "nope.json")).toBeNull();
  });

  it("extracts a prefixed subtree with the prefix stripped (mrpack overrides)", async () => {
    const zipPath = path.join(tmpDir, "pack.mrpack");
    await buildZip(zipPath, {
      "modrinth.index.json": "{}",
      "overrides/config/shared.toml": "from-overrides",
      "overrides/config/only-client.toml": "client",
      "server-overrides/config/shared.toml": "from-server-overrides",
    });
    const dest = path.join(tmpDir, "server");

    const first = await extractZipSubtree(zipPath, dest, { prefix: "overrides/" });
    expect(first.sort()).toEqual(["config/only-client.toml", "config/shared.toml"]);
    expect(await readFile(path.join(dest, "config", "shared.toml"), "utf8")).toBe("from-overrides");

    // server-overrides/ applied after overrides/ wins — the provisioner's order.
    await extractZipSubtree(zipPath, dest, { prefix: "server-overrides/" });
    expect(await readFile(path.join(dest, "config", "shared.toml"), "utf8")).toBe(
      "from-server-overrides",
    );
    // The index never leaks into the server dir.
    expect(await pathExists(path.join(dest, "modrinth.index.json"))).toBe(false);
  });

  it("BLOCKS zip-slip entries (.. traversal)", async () => {
    // yazl (correctly) refuses to create malicious names, so build a benign
    // zip and byte-patch the stored name to "../evil.txt" (same length).
    const zipPath = path.join(tmpDir, "slip.zip");
    await buildZip(zipPath, { "AA/evil.txt": "boom" });
    const bytes = await readFile(zipPath);
    const patched = Buffer.from(
      bytes.toString("latin1").replaceAll("AA/evil.txt", "../evil.txt"),
      "latin1",
    );
    await writeFile(zipPath, patched);

    const dest = path.join(tmpDir, "out");
    // Both defenses are acceptable: yauzl's own name validation, or our
    // isSafeRelPath guard (whichever fires first).
    await expect(extractZipSubtree(zipPath, dest)).rejects.toThrow(
      /invalid relative path|unsafe zip entry/i,
    );
    expect(await pathExists(path.join(tmpDir, "evil.txt"))).toBe(false);
  });

  it("normalizes backslash entry names from Windows-built zips", async () => {
    const zipPath = path.join(tmpDir, "win.zip");
    await buildZip(zipPath, { "AB/sub/x.txt": "windows" });
    const bytes = await readFile(zipPath);
    const patched = Buffer.from(
      bytes.toString("latin1").replaceAll("AB/sub/x.txt", "AB\\sub\\x.txt"),
      "latin1",
    );
    await writeFile(zipPath, patched);

    const dest = path.join(tmpDir, "out-win");
    const extracted = await extractZipSubtree(zipPath, dest);
    expect(extracted).toEqual(["AB/sub/x.txt"]);
    expect(await readFile(path.join(dest, "AB", "sub", "x.txt"), "utf8")).toBe("windows");
  });
});
