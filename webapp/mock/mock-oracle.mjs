/**
 * Mock oracle for offline development and tests. Zero dependencies.
 *
 * Honest to docs/oracle-api.md: same endpoints, same shapes, same error
 * format, same CORS headers. Biomes come from deterministic multi-octave
 * value noise (hash-based, seed- and dimension-salted) so tiles look
 * organic; structures come from a deterministic jittered placement grid.
 *
 * Usage:  node mock/mock-oracle.mjs [--port 8765] [--seed 1234]
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Deterministic hashing / noise
// ---------------------------------------------------------------------------

/** FNV-1a fold of a string to an unsigned 32-bit salt. */
function foldString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer lattice hash -> [0, 1). */
function hash2(ix, iz, salt) {
  let h = (salt ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ ix, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ iz, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise at the given block scale. */
function smoothNoise(x, z, scale, salt) {
  const fx = Math.floor(x / scale);
  const fz = Math.floor(z / scale);
  const tx = (x - fx * scale) / scale;
  const tz = (z - fz * scale) / scale;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(fx, fz, salt);
  const b = hash2(fx + 1, fz, salt);
  const c = hash2(fx, fz + 1, salt);
  const d = hash2(fx + 1, fz + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// ---------------------------------------------------------------------------
// Registries (a few minecraft: / terralith: / cobbleverse: entries)
// ---------------------------------------------------------------------------

const DIM_OVERWORLD = "minecraft:overworld";
const DIM_NETHER = "minecraft:the_nether";
const DIM_END = "minecraft:the_end";
const DIMENSIONS = [DIM_OVERWORLD, DIM_NETHER, DIM_END];

const BIOMES = [
  { id: "minecraft:ocean", color: "#3f76e4", dims: [DIM_OVERWORLD] },
  { id: "minecraft:plains", color: "#91bd59", dims: [DIM_OVERWORLD] },
  { id: "minecraft:forest", color: "#4a7a36", dims: [DIM_OVERWORLD] },
  { id: "minecraft:desert", color: "#d9d29b", dims: [DIM_OVERWORLD] },
  { id: "minecraft:snowy_taiga", color: "#cfe2f0", dims: [DIM_OVERWORLD] },
  { id: "terralith:alpine_grove", color: "#6a9f4b", dims: [DIM_OVERWORLD] },
  { id: "terralith:lavender_forest", color: "#b57edc", dims: [DIM_OVERWORLD] },
  { id: "cobbleverse:pokemeadow", color: "#58d68d", dims: [DIM_OVERWORLD] },
  { id: "minecraft:nether_wastes", color: "#6f2f2f", dims: [DIM_NETHER] },
  { id: "minecraft:crimson_forest", color: "#a12722", dims: [DIM_NETHER] },
  { id: "minecraft:warped_forest", color: "#167e86", dims: [DIM_NETHER] },
  { id: "minecraft:soul_sand_valley", color: "#7a6a55", dims: [DIM_NETHER] },
  { id: "minecraft:the_end", color: "#e0e0a8", dims: [DIM_END] },
  { id: "minecraft:end_highlands", color: "#c5c58f", dims: [DIM_END] },
  { id: "minecraft:small_end_islands", color: "#9a9a77", dims: [DIM_END] },
];

const BIOME_COLOR = new Map(BIOMES.map((b) => [b.id, b.color]));
const DIM_BIOMES = new Map(
  DIMENSIONS.map((dim) => [dim, BIOMES.filter((b) => b.dims.includes(dim)).map((b) => b.id)]),
);

/** spacing is in chunks; every structure gets its own placement grid. */
const STRUCTURES = [
  { id: "minecraft:village_plains", set: "minecraft:villages", dims: [DIM_OVERWORLD], spacing: 24 },
  { id: "minecraft:desert_pyramid", set: "minecraft:desert_pyramids", dims: [DIM_OVERWORLD], spacing: 28 },
  { id: "minecraft:ancient_city", set: "minecraft:ancient_cities", dims: [DIM_OVERWORLD], spacing: 32 },
  { id: "minecraft:fortress", set: "minecraft:nether_complexes", dims: [DIM_NETHER], spacing: 20 },
  { id: "minecraft:bastion_remnant", set: "minecraft:nether_complexes", dims: [DIM_NETHER], spacing: 26 },
  { id: "minecraft:end_city", set: "minecraft:end_cities", dims: [DIM_END], spacing: 24 },
  { id: "terralith:fortified_village", set: "terralith:fortified_villages", dims: [DIM_OVERWORLD], spacing: 26 },
  { id: "terralith:spire", set: "terralith:spires", dims: [DIM_OVERWORLD], spacing: 30 },
  { id: "cobbleverse:gym_fire", set: "cobbleverse:gyms", dims: [DIM_OVERWORLD], spacing: 40 },
  { id: "cobbleverse:gym_water", set: "cobbleverse:gyms", dims: [DIM_OVERWORLD], spacing: 40 },
  { id: "cobbleverse:legendary_monument", set: "cobbleverse:monuments", dims: [DIM_OVERWORLD], spacing: 48 },
];

const STRUCTURE_BY_ID = new Map(STRUCTURES.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Worldgen (all deterministic in seed + dimension + coords)
// ---------------------------------------------------------------------------

function biomeAt(seedSalt, dim, x, z) {
  const list = DIM_BIOMES.get(dim);
  if (!list || list.length === 0) return "minecraft:plains";
  const salt = (seedSalt ^ foldString(dim)) >>> 0;
  const v =
    0.55 * smoothNoise(x, z, 1024, salt) +
    0.3 * smoothNoise(x, z, 256, (salt ^ 0x9e3779b9) >>> 0) +
    0.15 * smoothNoise(x, z, 64, (salt ^ 0x85ebca6b) >>> 0);
  // Stretch around 0.5 so edge biomes are not vanishingly rare.
  const stretched = Math.min(0.999, Math.max(0, (v - 0.5) * 2.2 + 0.5));
  return list[Math.floor(stretched * list.length)];
}

/** Jittered candidate chunk of `structure`'s grid cell (ci, cj). */
function candidateInCell(seedSalt, structure, ci, cj) {
  const salt = (seedSalt ^ foldString(structure.id)) >>> 0;
  const jx = Math.floor(hash2(ci, cj, salt) * structure.spacing);
  const jz = Math.floor(hash2(ci, cj, (salt ^ 0x27d4eb2f) >>> 0) * structure.spacing);
  const chunkX = ci * structure.spacing + jx;
  const chunkZ = cj * structure.spacing + jz;
  return { chunkX, chunkZ, blockX: chunkX * 16 + 8, blockZ: chunkZ * 16 + 8 };
}

/** Deterministic verification roll for a candidate. */
function verification(seedSalt, structure, ci, cj) {
  const salt = (seedSalt ^ foldString(structure.id) ^ 0x5bd1e995) >>> 0;
  const roll = hash2(ci, cj, salt);
  if (roll < 0.55) return "start_ok";
  if (roll < 0.8) return "biome_ok";
  return "grid";
}

const LEVEL_RANK = { grid: 0, biome_ok: 1, start_ok: 2 };

/** All candidates of one structure intersecting a chunk bbox, at min level. */
function placedInBox(seedSalt, structure, minChunkX, minChunkZ, maxChunkX, maxChunkZ, level) {
  const out = [];
  const s = structure.spacing;
  const ci0 = Math.floor(minChunkX / s) - 1;
  const ci1 = Math.floor(maxChunkX / s) + 1;
  const cj0 = Math.floor(minChunkZ / s) - 1;
  const cj1 = Math.floor(maxChunkZ / s) + 1;
  for (let ci = ci0; ci <= ci1; ci++) {
    for (let cj = cj0; cj <= cj1; cj++) {
      const cand = candidateInCell(seedSalt, structure, ci, cj);
      if (
        cand.chunkX < minChunkX ||
        cand.chunkX > maxChunkX ||
        cand.chunkZ < minChunkZ ||
        cand.chunkZ > maxChunkZ
      ) {
        continue;
      }
      const achieved = verification(seedSalt, structure, ci, cj);
      if (LEVEL_RANK[achieved] < LEVEL_RANK[level]) continue;
      out.push({
        id: structure.id,
        structureSet: structure.set,
        x: cand.blockX,
        z: cand.blockZ,
        chunkX: cand.chunkX,
        chunkZ: cand.chunkZ,
        level,
        ci,
        cj,
      });
    }
  }
  return out;
}

/** Nearest biome_ok-verified candidate of `structure` from block (x, z). */
function locateNearest(seedSalt, structure, x, z) {
  const s = structure.spacing;
  const originCi = Math.floor(x / 16 / s);
  const originCj = Math.floor(z / 16 / s);
  let best = null;
  for (let r = 0; r <= 64; r++) {
    for (let ci = originCi - r; ci <= originCi + r; ci++) {
      for (let cj = originCj - r; cj <= originCj + r; cj++) {
        if (Math.max(Math.abs(ci - originCi), Math.abs(cj - originCj)) !== r) continue;
        if (verification(seedSalt, structure, ci, cj) === "grid") continue;
        const cand = candidateInCell(seedSalt, structure, ci, cj);
        const dist = Math.hypot(cand.blockX - x, cand.blockZ - z);
        if (best === null || dist < best.distance) {
          best = { x: cand.blockX, z: cand.blockZ, distance: dist };
        }
      }
    }
    // A hit found at ring r cannot be beaten by ring r + 2 onwards; one extra
    // ring covers jitter spill-over.
    if (best !== null && r >= 1) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// PNG encoder (pure node: zlib deflate + hand-rolled chunks)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode 8-bit RGB pixels (3 bytes/px, row-major) as a PNG. */
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function renderTile(seedSalt, dim, z, tx, tz) {
  const size = 256;
  const bpp = 4 * 2 ** z; // blocks per pixel
  const span = 1024 * 2 ** z;
  const rgb = Buffer.alloc(size * size * 3);
  const colorCache = new Map();
  for (let py = 0; py < size; py++) {
    const blockZ = tz * span + Math.floor((py + 0.5) * bpp);
    for (let px = 0; px < size; px++) {
      const blockX = tx * span + Math.floor((px + 0.5) * bpp);
      const biome = biomeAt(seedSalt, dim, blockX, blockZ);
      let color = colorCache.get(biome);
      if (!color) {
        color = hexToRgb(BIOME_COLOR.get(biome) ?? "#666666");
        colorCache.set(biome, color);
      }
      const o = (py * size + px) * 3;
      rgb[o] = color[0];
      rgb[o + 1] = color[1];
      rgb[o + 2] = color[2];
    }
  }
  return encodePng(size, size, rgb);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function intParam(params, name) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "" || !/^-?\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

/**
 * Create the mock oracle HTTP server (not yet listening).
 * @param {{ seed?: string }} [options]
 */
export function createMockOracle(options = {}) {
  const seed = options.seed ?? "1234";
  const seedSalt = foldString(String(seed));

  const meta = {
    mcVersion: "1.21.1",
    loaderVersion: "0.16.14",
    oracleModVersion: "0.1.0-mock",
    seed: String(seed),
    packName: "Mockpack",
    packVersion: "1.0.0",
    packFingerprint:
      "sha256:m0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ckm0ck",
    overlayDiff: [],
    dimensions: DIMENSIONS,
    mods: [
      { id: "fabric-api", version: "0.116.14+1.21.1", name: "Fabric API" },
      { id: "seedmap-oracle", version: "0.1.0-mock", name: "Seedmap Oracle (mock)" },
      { id: "terralith", version: "2.5.4", name: "Terralith" },
      { id: "cobbleverse", version: "1.7.2", name: "Cobbleverse" },
    ],
  };

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) {
        sendError(res, 500, "internal", String(err?.message ?? err));
      } else {
        res.end();
      }
    });
  });

  async function handle(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = url.pathname
      .split("/")
      .filter((s) => s !== "")
      .map((s) => decodeURIComponent(s));
    const q = url.searchParams;

    // GET /meta
    if (req.method === "GET" && url.pathname === "/meta") {
      sendJson(res, 200, meta);
      return;
    }

    // GET /biome?dim=&x=&y=&z=
    if (req.method === "GET" && url.pathname === "/biome") {
      const dim = q.get("dim");
      const x = intParam(q, "x");
      const y = intParam(q, "y");
      const z = intParam(q, "z");
      if (dim === null || x === null || y === null || z === null) {
        sendError(res, 400, "bad_param", "dim, x, y, z are required");
        return;
      }
      if (!DIM_BIOMES.has(dim)) {
        sendError(res, 404, "unknown_dimension", `unknown dimension: ${dim}`);
        return;
      }
      sendJson(res, 200, { dim, x, y, z, biome: biomeAt(seedSalt, dim, x, z) });
      return;
    }

    // POST /biomes/grid
    if (req.method === "POST" && url.pathname === "/biomes/grid") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendError(res, 400, "bad_param", "invalid JSON body");
        return;
      }
      const { dim, y, minX, minZ, step, w, h } = body ?? {};
      if (
        typeof dim !== "string" ||
        ![y, minX, minZ, step, w, h].every((v) => Number.isInteger(v)) ||
        step < 1 ||
        w < 1 ||
        h < 1
      ) {
        sendError(res, 400, "bad_param", "expected {dim, y, minX, minZ, step>=1, w>=1, h>=1}");
        return;
      }
      if (!DIM_BIOMES.has(dim)) {
        sendError(res, 404, "unknown_dimension", `unknown dimension: ${dim}`);
        return;
      }
      if (w * h > 262144) {
        sendError(res, 400, "too_large", "w*h must be <= 262144");
        return;
      }
      const palette = [];
      const paletteIndex = new Map();
      const data = new Array(w * h);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const biome = biomeAt(seedSalt, dim, minX + col * step, minZ + row * step);
          let idx = paletteIndex.get(biome);
          if (idx === undefined) {
            idx = palette.length;
            palette.push(biome);
            paletteIndex.set(biome, idx);
          }
          data[row * w + col] = idx;
        }
      }
      sendJson(res, 200, { dim, y, minX, minZ, step, w, h, palette, data });
      return;
    }

    // GET /tiles/{dim}/{y}/{z}/{tx}/{tz}.png
    if (req.method === "GET" && segments[0] === "tiles") {
      if (segments.length !== 6 || !segments[5].endsWith(".png")) {
        sendError(res, 404, "not_found", "expected /tiles/{dim}/{y}/{z}/{tx}/{tz}.png");
        return;
      }
      const [, dim, yStr, zStr, txStr, tzRaw] = segments;
      const tzStr = tzRaw.slice(0, -".png".length);
      if (![yStr, zStr, txStr, tzStr].every((s) => /^-?\d+$/.test(s))) {
        sendError(res, 400, "bad_param", "y, z, tx, tz must be integers");
        return;
      }
      const z = Number(zStr);
      if (z < 0 || z > 6) {
        sendError(res, 400, "bad_param", "zoom must be in [0, 6]");
        return;
      }
      if (!DIM_BIOMES.has(dim)) {
        sendError(res, 404, "unknown_dimension", `unknown dimension: ${dim}`);
        return;
      }
      const png = renderTile(seedSalt, dim, z, Number(txStr), Number(tzStr));
      res.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": png.length,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(png);
      return;
    }

    // GET /structures/candidates?dim=&structureSet=&minX=&minZ=&maxX=&maxZ=
    if (req.method === "GET" && url.pathname === "/structures/candidates") {
      const dim = q.get("dim");
      const structureSet = q.get("structureSet");
      const box = ["minX", "minZ", "maxX", "maxZ"].map((k) => intParam(q, k));
      if (dim === null || structureSet === null || box.some((v) => v === null)) {
        sendError(res, 400, "bad_param", "dim, structureSet, minX, minZ, maxX, maxZ required");
        return;
      }
      if (!DIM_BIOMES.has(dim)) {
        sendError(res, 404, "unknown_dimension", `unknown dimension: ${dim}`);
        return;
      }
      const members = STRUCTURES.filter((s) => s.set === structureSet && s.dims.includes(dim));
      if (members.length === 0) {
        sendError(res, 404, "unknown_structure_set", `unknown structure set: ${structureSet}`);
        return;
      }
      const [minX, minZ, maxX, maxZ] = box;
      if ((maxX - minX) / 16 > 512 || (maxZ - minZ) / 16 > 512) {
        sendError(res, 400, "too_large", "bbox limited to 512x512 chunks");
        return;
      }
      const candidates = [];
      for (const s of members) {
        for (const f of placedInBox(
          seedSalt,
          s,
          Math.floor(minX / 16),
          Math.floor(minZ / 16),
          Math.floor(maxX / 16),
          Math.floor(maxZ / 16),
          "grid",
        )) {
          candidates.push({ chunkX: f.chunkX, chunkZ: f.chunkZ, blockX: f.x, blockZ: f.z });
        }
      }
      sendJson(res, 200, { dim, structureSet, candidates });
      return;
    }

    // GET /structures/placed?dim=&minX=&minZ=&maxX=&maxZ=[&types=][&level=]
    if (req.method === "GET" && url.pathname === "/structures/placed") {
      const dim = q.get("dim");
      const box = ["minX", "minZ", "maxX", "maxZ"].map((k) => intParam(q, k));
      if (dim === null || box.some((v) => v === null)) {
        sendError(res, 400, "bad_param", "dim, minX, minZ, maxX, maxZ required");
        return;
      }
      if (!DIM_BIOMES.has(dim)) {
        sendError(res, 404, "unknown_dimension", `unknown dimension: ${dim}`);
        return;
      }
      const level = q.get("level") ?? "biome_ok";
      if (level !== "biome_ok" && level !== "start_ok") {
        sendError(res, 400, "bad_param", "level must be biome_ok or start_ok");
        return;
      }
      const [minX, minZ, maxX, maxZ] = box;
      if ((maxX - minX) / 16 > 512 || (maxZ - minZ) / 16 > 512) {
        sendError(res, 400, "too_large", "bbox limited to 512x512 chunks");
        return;
      }
      const typesParam = q.get("types");
      let structures = STRUCTURES.filter((s) => s.dims.includes(dim));
      if (typesParam !== null && typesParam.trim() !== "") {
        const wanted = new Set(typesParam.split(",").map((s) => s.trim()));
        for (const id of wanted) {
          if (!STRUCTURE_BY_ID.has(id)) {
            sendError(res, 404, "unknown_structure", `unknown structure: ${id}`);
            return;
          }
        }
        structures = structures.filter((s) => wanted.has(s.id));
      }
      const features = [];
      for (const s of structures) {
        for (const f of placedInBox(
          seedSalt,
          s,
          Math.floor(minX / 16),
          Math.floor(minZ / 16),
          Math.floor(maxX / 16),
          Math.floor(maxZ / 16),
          level,
        )) {
          features.push({
            id: f.id,
            structureSet: f.structureSet,
            x: f.x,
            z: f.z,
            chunkX: f.chunkX,
            chunkZ: f.chunkZ,
            level: f.level,
          });
        }
      }
      sendJson(res, 200, { dim, features });
      return;
    }

    // GET /locate?dim=&x=&z=&structure=
    if (req.method === "GET" && url.pathname === "/locate") {
      const dim = q.get("dim");
      const x = intParam(q, "x");
      const z = intParam(q, "z");
      const structureId = q.get("structure");
      if (dim === null || x === null || z === null || structureId === null) {
        sendError(res, 400, "bad_param", "dim, x, z, structure required");
        return;
      }
      if (!DIM_BIOMES.has(dim)) {
        sendError(res, 404, "unknown_dimension", `unknown dimension: ${dim}`);
        return;
      }
      const structure = STRUCTURE_BY_ID.get(structureId);
      if (!structure) {
        sendError(res, 404, "unknown_structure", `unknown structure: ${structureId}`);
        return;
      }
      if (!structure.dims.includes(dim)) {
        sendError(res, 404, "not_found", `${structureId} does not generate in ${dim}`);
        return;
      }
      const best = locateNearest(seedSalt, structure, x, z);
      if (best === null) {
        sendError(res, 404, "not_found", `no ${structureId} found near (${x}, ${z})`);
        return;
      }
      sendJson(res, 200, {
        structure: structureId,
        x: best.x,
        z: best.z,
        distance: Math.round(best.distance * 10) / 10,
      });
      return;
    }

    // GET /registry/structures
    if (req.method === "GET" && url.pathname === "/registry/structures") {
      sendJson(res, 200, {
        structures: STRUCTURES.map((s) => ({
          id: s.id,
          namespace: s.id.split(":")[0],
          sets: [s.set],
          dimensions: s.dims,
        })),
      });
      return;
    }

    // GET /registry/biomes
    if (req.method === "GET" && url.pathname === "/registry/biomes") {
      sendJson(res, 200, {
        biomes: BIOMES.map((b) => ({
          id: b.id,
          namespace: b.id.split(":")[0],
          color: b.color,
        })),
      });
      return;
    }

    // POST /seed/verify
    if (req.method === "POST" && url.pathname === "/seed/verify") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendError(res, 400, "bad_param", "invalid JSON body");
        return;
      }
      const candidates = body?.candidates;
      const observations = body?.observations;
      if (!Array.isArray(candidates) || !Array.isArray(observations)) {
        sendError(res, 400, "bad_param", "expected {candidates: [], observations: []}");
        return;
      }
      if (candidates.length > 16 || observations.length > 256) {
        sendError(res, 400, "too_large", "<= 16 candidates and <= 256 observations");
        return;
      }
      const results = candidates.map((candidate) => {
        const candSalt = foldString(String(candidate));
        let matches = 0;
        let total = 0;
        const details = observations.map((obs, index) => {
          if (obs?.type === "bedrock") {
            return { index, match: null, unsupported: true };
          }
          if (obs?.type === "biome") {
            const actual = biomeAt(candSalt, obs.dim, obs.x, obs.z);
            total++;
            const match = actual === obs.expected;
            if (match) matches++;
            return { index, match, actual };
          }
          if (obs?.type === "structure") {
            const structure = STRUCTURE_BY_ID.get(obs.expected);
            total++;
            let match = false;
            if (structure) {
              const chunkX = Math.floor(obs.x / 16);
              const chunkZ = Math.floor(obs.z / 16);
              const ci = Math.floor(chunkX / structure.spacing);
              const cj = Math.floor(chunkZ / structure.spacing);
              for (let di = -1; di <= 1 && !match; di++) {
                for (let dj = -1; dj <= 1 && !match; dj++) {
                  const cand = candidateInCell(candSalt, structure, ci + di, cj + dj);
                  match =
                    cand.chunkX === chunkX &&
                    cand.chunkZ === chunkZ &&
                    verification(candSalt, structure, ci + di, cj + dj) !== "grid";
                }
              }
            }
            if (match) matches++;
            return { index, match };
          }
          return { index, match: null, unsupported: true };
        });
        return {
          seed: String(candidate),
          matches,
          total,
          verdict: matches === total && total > 0 ? "match" : "mismatch",
          details,
        };
      });
      sendJson(res, 200, { results });
      return;
    }

    sendError(res, 404, "not_found", `no such endpoint: ${req.method} ${url.pathname}`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(argValue("--port") ?? 8765);
  const seed = argValue("--seed") ?? "1234";
  const server = createMockOracle({ seed });
  server.listen(port, "127.0.0.1", () => {
    console.log(`mock oracle listening on http://127.0.0.1:${port} (seed ${seed})`);
  });
}
