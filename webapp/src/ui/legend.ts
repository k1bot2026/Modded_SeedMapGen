import { el } from "../lib/dom";
import type { BiomeRegistryEntry } from "../lib/types";

/** Collapsible biome legend with a namespace/id text filter. */
export function createLegend(biomes: BiomeRegistryEntry[]): HTMLElement {
  const list = el("div", { class: "legend-list" });
  const count = el("span", { class: "legend-count" });

  const rows = biomes
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((biome) => {
      const row = el(
        "div",
        { class: "legend-row", "data-biome-id": biome.id },
        el("span", {
          class: "legend-swatch",
          style: `background:${biome.color}`,
        }),
        el("span", { class: "mono legend-id" }, biome.id),
      );
      return { biome, row };
    });

  const applyFilter = (query: string): void => {
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const { biome, row } of rows) {
      const visible = q === "" || biome.id.toLowerCase().includes(q);
      row.style.display = visible ? "" : "none";
      if (visible) shown++;
    }
    count.textContent = `${shown}/${rows.length}`;
  };

  const filter = el("input", {
    class: "legend-filter",
    type: "search",
    placeholder: "filter (e.g. terralith)",
    "aria-label": "Filter biomes by namespace or id",
  });
  filter.addEventListener("input", () => {
    applyFilter(filter.value);
  });

  list.append(...rows.map((r) => r.row));
  applyFilter("");

  const details = el(
    "details",
    { class: "panel-section legend" },
    el("summary", {}, "Biome legend ", count),
    filter,
    list,
  );
  return details;
}
