import { copyButton, el } from "../lib/dom";
import { groupByNamespace } from "../lib/layer-tokens";
import type { BiomeRegistryEntry, StructureRegistryEntry } from "../lib/types";

export interface SearchPanelOptions {
  structures: StructureRegistryEntry[];
  biomes: BiomeRegistryEntry[];
  /** origin "center" = map center; "pick" = arm one-shot click-to-pick mode. */
  onLocate(structureId: string, origin: "center" | "pick"): void;
  onBiomeSearch(biomeId: string): void;
}

export interface LocateResult {
  structure: string;
  x: number;
  z: number;
  distance: number;
}

export interface SearchPanel {
  element: HTMLElement;
  setLocateStatus(text: string): void;
  setLocateResult(result: LocateResult, onGo: () => void): void;
  setBiomeStatus(text: string): void;
  setBiomeResult(
    biome: string,
    x: number,
    z: number,
    distance: number,
    onGo: () => void,
  ): void;
}

function groupedSelect(
  ids: readonly string[],
  ariaLabel: string,
  className: string,
): HTMLSelectElement {
  const select = el("select", { class: className, "aria-label": ariaLabel });
  const groups = groupByNamespace([...ids]);
  for (const ns of [...groups.keys()].sort()) {
    const optgroup = el("optgroup");
    optgroup.label = ns;
    for (const id of (groups.get(ns) ?? []).slice().sort()) {
      optgroup.append(el("option", { value: id }, id));
    }
    select.append(optgroup);
  }
  return select;
}

function goRow(
  label: string,
  x: number,
  z: number,
  distance: number,
  onGo: () => void,
): HTMLElement {
  const goBtn = el("button", { class: "mini-btn", type: "button" }, "go");
  goBtn.addEventListener("click", onGo);
  return el(
    "div",
    { class: "search-result" },
    el("div", { class: "mono search-result-id" }, label),
    el("div", {}, `x ${x}, z ${z} · ${Math.round(distance)} blocks away`),
    el(
      "div",
      { class: "search-result-actions" },
      goBtn,
      copyButton(`/tp @s ${x} ~ ${z}`, "copy /tp", "mini-btn"),
    ),
  );
}

export function createSearchPanel(options: SearchPanelOptions): SearchPanel {
  const structureSelect = groupedSelect(
    options.structures.map((s) => s.id),
    "Structure type to locate",
    "search-select structure-select",
  );
  const biomeSelect = groupedSelect(
    options.biomes.map((b) => b.id),
    "Biome to search for",
    "search-select biome-select",
  );

  const locateStatus = el("div", { class: "panel-status" });
  const locateResult = el("div", {});
  const biomeStatus = el("div", { class: "panel-status" });
  const biomeResult = el("div", {});

  const locateCenterBtn = el(
    "button",
    { class: "action-btn", type: "button" },
    "nearest from center",
  );
  locateCenterBtn.addEventListener("click", () => {
    options.onLocate(structureSelect.value, "center");
  });
  const locatePickBtn = el(
    "button",
    { class: "action-btn", type: "button", title: "Then click a point on the map" },
    "pick point…",
  );
  locatePickBtn.addEventListener("click", () => {
    options.onLocate(structureSelect.value, "pick");
  });

  const biomeSearchBtn = el(
    "button",
    { class: "action-btn", type: "button" },
    "search from center",
  );
  biomeSearchBtn.addEventListener("click", () => {
    options.onBiomeSearch(biomeSelect.value);
  });

  const details = el(
    "details",
    { class: "panel-section search" },
    el("summary", {}, "Search"),
    el("h3", {}, "Nearest structure"),
    structureSelect,
    el("div", { class: "search-actions" }, locateCenterBtn, locatePickBtn),
    locateStatus,
    locateResult,
    el("h3", {}, "Nearest biome"),
    biomeSelect,
    el("div", { class: "search-actions" }, biomeSearchBtn),
    biomeStatus,
    biomeResult,
  );
  details.open = true;

  return {
    element: details,
    setLocateStatus(text: string): void {
      locateStatus.textContent = text;
      locateResult.replaceChildren();
    },
    setLocateResult(result: LocateResult, onGo: () => void): void {
      locateStatus.textContent = "";
      locateResult.replaceChildren(
        goRow(result.structure, result.x, result.z, result.distance, onGo),
      );
    },
    setBiomeStatus(text: string): void {
      biomeStatus.textContent = text;
      biomeResult.replaceChildren();
    },
    setBiomeResult(biome, x, z, distance, onGo): void {
      biomeStatus.textContent = "";
      biomeResult.replaceChildren(goRow(biome, x, z, distance, onGo));
    },
  };
}
