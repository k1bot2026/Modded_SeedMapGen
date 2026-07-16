import { copyButton, el } from "../lib/dom";
import type { OracleMeta } from "../lib/types";

export interface BannerOptions {
  meta: OracleMeta;
  initialDim: string;
  initialY: number;
  onDimChange(dim: string): void;
  onYChange(y: number): void;
}

export interface Banner {
  element: HTMLElement;
}

const FINGERPRINT_SHOWN = 18;

export function createBanner(options: BannerOptions): Banner {
  const { meta } = options;

  const fingerprintShort =
    meta.packFingerprint.length > FINGERPRINT_SHOWN
      ? `${meta.packFingerprint.slice(0, FINGERPRINT_SHOWN)}…`
      : meta.packFingerprint;
  const fingerprintBtn = el(
    "button",
    {
      class: "chip mono chip-copy",
      type: "button",
      title: `${meta.packFingerprint} (click to copy)`,
    },
    fingerprintShort,
  );
  fingerprintBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(meta.packFingerprint).then(
      () => flash(fingerprintBtn, "copied!"),
      () => flash(fingerprintBtn, "copy failed"),
    );
  });

  const dimSelect = el("select", {
    class: "banner-select",
    "aria-label": "Dimension",
  });
  for (const dim of meta.dimensions) {
    const opt = el("option", { value: dim }, dim);
    if (dim === options.initialDim) opt.selected = true;
    dimSelect.append(opt);
  }
  dimSelect.addEventListener("change", () => {
    options.onDimChange(dimSelect.value);
  });

  const yInput = el("input", {
    class: "banner-y",
    type: "number",
    value: String(options.initialY),
    step: "1",
    "aria-label": "Sampling Y level",
    title: "Sampling Y level",
  });
  yInput.addEventListener("change", () => {
    const y = Math.trunc(Number(yInput.value));
    if (Number.isFinite(y)) {
      yInput.value = String(y);
      options.onYChange(y);
    }
  });

  const element = el(
    "header",
    { class: "banner" },
    el(
      "div",
      { class: "banner-pack" },
      el("strong", {}, meta.packName),
      el("span", { class: "chip" }, meta.packVersion),
    ),
    el(
      "div",
      { class: "banner-items" },
      fingerprintBtn,
      el("span", { class: "banner-label" }, "seed"),
      copyButton(meta.seed, meta.seed, "chip mono chip-copy"),
      el("span", { class: "chip" }, `MC ${meta.mcVersion}`),
    ),
    el(
      "div",
      { class: "banner-controls" },
      el("label", { class: "banner-label" }, "dim"),
      dimSelect,
      el("label", { class: "banner-label" }, "y"),
      yInput,
    ),
  );

  return { element };
}

function flash(btn: HTMLButtonElement, text: string): void {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}
