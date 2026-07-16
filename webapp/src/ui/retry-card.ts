import { el } from "../lib/dom";

let pollTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Full-screen "oracle unreachable" card with a curl hint, a retry button and
 * a 5 s auto-poll.
 */
export function renderRetryCard(
  root: HTMLElement,
  base: string,
  err: unknown,
  onRetry: () => void,
): void {
  if (pollTimer !== undefined) clearInterval(pollTimer);

  const retry = (): void => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    pollTimer = undefined;
    onRetry();
  };

  const message = err instanceof Error ? err.message : String(err);
  const retryBtn = el("button", { class: "retry-btn", type: "button" }, "Retry now");
  retryBtn.addEventListener("click", retry);

  root.replaceChildren(
    el(
      "div",
      { class: "retry-wrap" },
      el(
        "div",
        { class: "retry-card" },
        el("h1", {}, "Oracle unreachable"),
        el("p", {}, `Could not reach the oracle at ${base}.`),
        el("p", { class: "retry-detail mono" }, message),
        el("p", {}, "Check that it is up:"),
        el("pre", { class: "mono" }, `curl ${base}/meta`),
        el(
          "p",
          {},
          "Start it with ",
          el("code", { class: "mono" }, "seedmap run <runDir> --seed <seed>"),
          " — or for offline dev: ",
          el("code", { class: "mono" }, "pnpm run mock"),
          ".",
        ),
        retryBtn,
        el("p", { class: "retry-note" }, "Retrying automatically every 5 s…"),
      ),
    ),
  );

  pollTimer = setInterval(retry, 5000);
}
