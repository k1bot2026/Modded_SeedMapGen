import { describe, expect, it } from "vitest";
import {
  oracleTileHttpUrl,
  oracleTileUrlTemplate,
  parseOracleTileUrl,
  protocolUrlToHttpUrl,
} from "../src/lib/oracle-url";

const BASE = "http://127.0.0.1:8765";
const DIM = "minecraft:overworld";

describe("oracleTileUrlTemplate", () => {
  it("builds a template with maplibre placeholders and encoded segments", () => {
    const tpl = oracleTileUrlTemplate(BASE, DIM, 64);
    expect(tpl).toBe(
      "oracle://http%3A%2F%2F127.0.0.1%3A8765/minecraft%3Aoverworld/64/{z}/{x}/{y}",
    );
  });

  it("supports negative y levels and rejects fractional ones", () => {
    expect(oracleTileUrlTemplate(BASE, DIM, -32)).toContain("/-32/{z}/{x}/{y}");
    expect(() => oracleTileUrlTemplate(BASE, DIM, 1.5)).toThrow(RangeError);
  });
});

describe("parseOracleTileUrl", () => {
  it("parses a substituted URL back into its parts", () => {
    const url = "oracle://http%3A%2F%2F127.0.0.1%3A8765/minecraft%3Aoverworld/64/6/31/33";
    expect(parseOracleTileUrl(url)).toEqual({
      base: BASE,
      dim: DIM,
      y: 64,
      displayZoom: 6,
      displayX: 31,
      displayY: 33,
    });
  });

  it("rejects malformed URLs", () => {
    expect(() => parseOracleTileUrl("oracle://a/b/64/6/31")).toThrow(/malformed/);
    expect(() => parseOracleTileUrl("https://a/b/64/6/31/33")).toThrow(/malformed/);
    expect(() => parseOracleTileUrl("oracle://a/b/x/6/31/33")).toThrow(/malformed/);
  });
});

describe("protocolUrlToHttpUrl", () => {
  it("translates display tiles to oracle tiles (negative indices, ':' kept)", () => {
    // d=6 -> oracle z=4, offset 2^5=32: (31, 33) -> (-1, 1)
    const url = "oracle://http%3A%2F%2F127.0.0.1%3A8765/minecraft%3Aoverworld/64/6/31/33";
    expect(protocolUrlToHttpUrl(url)).toBe(
      "http://127.0.0.1:8765/tiles/minecraft:overworld/64/4/-1/1.png",
    );
  });

  it("maps the native zoom center tile", () => {
    const url = "oracle://http%3A%2F%2Flocalhost%3A9999/terralith%3Askylands/-16/10/512/512";
    expect(protocolUrlToHttpUrl(url)).toBe(
      "http://localhost:9999/tiles/terralith:skylands/-16/0/0/0.png",
    );
  });

  it("rejects display zooms outside [4, 10]", () => {
    expect(() =>
      protocolUrlToHttpUrl("oracle://b/minecraft%3Aoverworld/64/3/0/0"),
    ).toThrow(RangeError);
    expect(() =>
      protocolUrlToHttpUrl("oracle://b/minecraft%3Aoverworld/64/11/0/0"),
    ).toThrow(RangeError);
  });
});

describe("oracleTileHttpUrl", () => {
  it("keeps the dimension id literal per the contract", () => {
    expect(oracleTileHttpUrl(BASE, "cobbleverse:safari", -8, 2, -5, 7)).toBe(
      "http://127.0.0.1:8765/tiles/cobbleverse:safari/-8/2/-5/7.png",
    );
  });
});
