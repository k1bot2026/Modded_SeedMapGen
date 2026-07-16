import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export async function hashFile(filePath: string, algorithm: "sha1" | "sha256" | "sha512"): Promise<string> {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function hashBuffer(data: Buffer | string, algorithm: "sha1" | "sha256" | "sha512"): string {
  return createHash(algorithm).update(data).digest("hex");
}
