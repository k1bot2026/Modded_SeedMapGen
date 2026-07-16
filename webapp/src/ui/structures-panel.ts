import { el } from "../lib/dom";
import { groupByNamespace } from "../lib/layer-tokens";
import type { StructureRegistryEntry } from "../lib/types";

export interface StructuresPanelOptions {
  entries: StructureRegistryEntry[];
  /** Shared live set — the panel mutates it, main reads it. */
  enabled: Set<string>;
  startOk: boolean;
  onChange(startOk: boolean): void;
}

export interface StructuresPanel {
  element: HTMLElement;
  setStatus(text: string): void;
}

export function createStructuresPanel(
  options: StructuresPanelOptions,
): StructuresPanel {
  const { entries, enabled } = options;
  let startOk = options.startOk;
  const checkboxes = new Map<string, HTMLInputElement>();

  const startOkInput = el("input", { type: "checkbox" });
  startOkInput.checked = startOk;
  startOkInput.addEventListener("change", () => {
    startOk = startOkInput.checked;
    options.onChange(startOk);
  });

  const status = el("div", { class: "panel-status" }, "No structure layers enabled.");

  const groups = groupByNamespace(entries.map((e) => e.id));
  const groupEls: HTMLElement[] = [];
  for (const ns of [...groups.keys()].sort()) {
    const ids = (groups.get(ns) ?? []).slice().sort();

    const list = el("div", { class: "group-list" });
    for (const id of ids) {
      const input = el("input", {
        type: "checkbox",
        "data-structure-id": id,
        "aria-label": id,
      });
      input.checked = enabled.has(id);
      input.addEventListener("change", () => {
        if (input.checked) enabled.add(id);
        else enabled.delete(id);
        options.onChange(startOk);
      });
      checkboxes.set(id, input);
      const shortName = id.startsWith(`${ns}:`) ? id.slice(ns.length + 1) : id;
      list.append(
        el("label", { class: "group-item", title: id }, input, shortName),
      );
    }

    const allBtn = el("button", { class: "mini-btn", type: "button" }, "all");
    const noneBtn = el("button", { class: "mini-btn", type: "button" }, "none");
    const setAll = (value: boolean): void => {
      for (const id of ids) {
        const input = checkboxes.get(id);
        if (input) input.checked = value;
        if (value) enabled.add(id);
        else enabled.delete(id);
      }
      options.onChange(startOk);
    };
    allBtn.addEventListener("click", () => {
      setAll(true);
    });
    noneBtn.addEventListener("click", () => {
      setAll(false);
    });

    const details = el(
      "details",
      { class: "group", "data-namespace": ns },
      el("summary", {}, el("span", { class: "group-ns" }, ns), ` (${ids.length})`),
      el("div", { class: "group-actions" }, allBtn, noneBtn),
      list,
    );
    details.open = true;
    groupEls.push(details);
  }

  const element = el(
    "aside",
    { class: "panel panel-structures" },
    el(
      "div",
      { class: "panel-header" },
      el("h2", {}, "Structures"),
      el(
        "label",
        { class: "startok-toggle", title: "Verify structure starts (start_ok — slower, game-accurate)" },
        startOkInput,
        "start_ok",
      ),
    ),
    ...groupEls,
    status,
  );

  return {
    element,
    setStatus(text: string): void {
      status.textContent = text;
    },
  };
}
