import { describe, expect, it } from "vitest";
import {
  mergeServerProperties,
  oracleServerProperties,
  parseServerProperties,
} from "../src/core/serverProperties.js";

describe("oracleServerProperties", () => {
  it("forces exactly the contract keys", () => {
    expect(oracleServerProperties("-42")).toEqual({
      "level-seed": "-42",
      "level-name": "world-oracle",
      "online-mode": "false",
      "view-distance": "2",
      "spawn-protection": "0",
      "max-tick-time": "-1",
    });
  });
});

describe("mergeServerProperties", () => {
  it("creates a fresh file when none exists", () => {
    const out = mergeServerProperties(null, oracleServerProperties("1234"));
    const parsed = parseServerProperties(out);
    expect(parsed.get("level-seed")).toBe("1234");
    expect(parsed.get("level-name")).toBe("world-oracle");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("preserves pack-provided keys and comments, overriding only managed keys", () => {
    const packProvided = [
      "# Pack tweaks — do not touch",
      "motd=Cobbleverse rocks",
      "level-seed=99999",
      "difficulty=hard",
      "level-type=minecraft\\:normal",
      "",
    ].join("\n");
    const out = mergeServerProperties(packProvided, oracleServerProperties("-123"));
    const parsed = parseServerProperties(out);
    expect(parsed.get("level-seed")).toBe("-123"); // overridden in place
    expect(parsed.get("motd")).toBe("Cobbleverse rocks"); // preserved
    expect(parsed.get("difficulty")).toBe("hard");
    expect(out).toContain("# Pack tweaks — do not touch");
    expect(parsed.get("level-name")).toBe("world-oracle"); // appended
    // No duplicated keys.
    expect(out.match(/^level-seed=/gm)).toHaveLength(1);
  });

  it("handles negative 64-bit seeds as opaque strings", () => {
    const out = mergeServerProperties(null, oracleServerProperties("-9223372036854775808"));
    expect(parseServerProperties(out).get("level-seed")).toBe("-9223372036854775808");
  });
});

describe("parseServerProperties", () => {
  it("reads level-seed for provision local", () => {
    const props = parseServerProperties(
      "#comment\nlevel-seed=-4530634556500121041\nmotd=A server\n",
    );
    expect(props.get("level-seed")).toBe("-4530634556500121041");
  });

  it("skips comments, blanks, and malformed lines", () => {
    const props = parseServerProperties("# a=b\n\nnot a property\n=novalue\nkey=v\n");
    expect(props.get("# a")).toBeUndefined();
    expect(props.get("key")).toBe("v");
    expect(props.size).toBe(1);
  });

  it("keeps everything after the first equals sign", () => {
    expect(parseServerProperties("motd=a=b=c\n").get("motd")).toBe("a=b=c");
  });
});
