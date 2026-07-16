/** Tiny DOM helpers — the app is vanilla TS, no framework. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Button that copies `text` and briefly flashes feedback. */
export function copyButton(
  text: string,
  label: string,
  className = "copy-btn",
): HTMLButtonElement {
  const btn = el("button", { class: className, type: "button" }, label);
  btn.addEventListener("click", () => {
    void copyText(text).then((ok) => {
      const original = label;
      btn.textContent = ok ? "copied!" : "copy failed";
      setTimeout(() => {
        btn.textContent = original;
      }, 1200);
    });
  });
  return btn;
}
