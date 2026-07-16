import { el } from "../lib/dom";

export interface CursorReadout {
  element: HTMLElement;
  setPosition(x: number, z: number): void;
  setBiome(biome: string | null): void;
  clear(): void;
}

/** Bottom-left chip: block coords under the mouse + debounced biome name. */
export function createCursorReadout(): CursorReadout {
  const coords = el("span", { class: "mono" }, "—");
  const biome = el("span", { class: "mono readout-biome" }, "");
  const element = el("div", { class: "cursor-readout" }, coords, biome);

  return {
    element,
    setPosition(x: number, z: number): void {
      coords.textContent = `x ${x}  z ${z}`;
    },
    setBiome(name: string | null): void {
      biome.textContent = name ?? "";
    },
    clear(): void {
      coords.textContent = "—";
      biome.textContent = "";
    },
  };
}
