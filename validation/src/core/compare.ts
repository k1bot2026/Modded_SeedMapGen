import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ByteDivergence {
  index: number;
  /** Byte value in A at index, or null when A ended first. */
  a: number | null;
  b: number | null;
}

/** First index at which two byte arrays differ, or null when byte-identical. */
export function firstByteDivergence(a: Uint8Array, b: Uint8Array): ByteDivergence | null {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return { index: i, a: a[i]!, b: b[i]! };
  }
  if (a.length !== b.length) {
    return {
      index: shared,
      a: a.length > shared ? a[shared]! : null,
      b: b.length > shared ? b[shared]! : null,
    };
  }
  return null;
}

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return `{${parts.join(",")}}`;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Human-readable description of the first structural difference between two
 * JSON values ("$.mods[3].version: \"1.0\" vs \"1.1\""), or null when equal.
 * Used to report self-consistency divergences precisely.
 */
export function firstJsonDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  const typeA = jsonType(a);
  const typeB = jsonType(b);
  if (typeA !== typeB) return `${path}: ${typeA} vs ${typeB}`;
  if (typeA === "array") {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    const shared = Math.min(arrA.length, arrB.length);
    for (let i = 0; i < shared; i++) {
      const diff = firstJsonDifference(arrA[i], arrB[i], `${path}[${i}]`);
      if (diff !== null) return diff;
    }
    if (arrA.length !== arrB.length) return `${path}: array length ${arrA.length} vs ${arrB.length}`;
    return null;
  }
  if (typeA === "object") {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(objA), ...Object.keys(objB)])].sort();
    for (const key of keys) {
      if (!(key in objA)) return `${path}.${key}: missing in A`;
      if (!(key in objB)) return `${path}.${key}: missing in B`;
      const diff = firstJsonDifference(objA[key], objB[key], `${path}.${key}`);
      if (diff !== null) return diff;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_MAGIC.length && PNG_MAGIC.every((byte, i) => bytes[i] === byte);
}
