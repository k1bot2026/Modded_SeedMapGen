/**
 * Pure classification of one locate-validation comparison:
 * /locate ground truth vs the expanding-bbox nearest search over
 * /structures/placed. Positions MUST agree exactly; "structure absent in
 * range" counts as agreement only when both sides find nothing.
 */
import type { LocateResult } from "../oracle-client.js";
import type { NearestResult } from "./nearest.js";

export type Agreement =
  | { agree: true; kind: "matched_position" | "both_not_found" }
  | { agree: false; reason: string };

export function classifyLocateAgreement(locate: LocateResult, nearest: NearestResult): Agreement {
  if (locate.found && nearest.feature !== null) {
    if (locate.x === nearest.feature.x && locate.z === nearest.feature.z) {
      return { agree: true, kind: "matched_position" };
    }
    return {
      agree: false,
      reason:
        `position mismatch: /locate -> (${locate.x}, ${locate.z}) at distance ${locate.distance.toFixed(1)}, ` +
        `placed-search -> (${nearest.feature.x}, ${nearest.feature.z})${nearest.exact ? "" : " (beyond search cap, inexact)"}`,
    };
  }
  if (!locate.found && nearest.feature === null) {
    return { agree: true, kind: "both_not_found" };
  }
  if (locate.found) {
    return {
      agree: false,
      reason:
        `/locate found (${locate.x}, ${locate.z}) at distance ${locate.distance.toFixed(1)} ` +
        `but placed-search found nothing within ${nearest.searchedRadius} blocks`,
    };
  }
  const feature = nearest.feature!;
  return {
    agree: false,
    reason: `placed-search found (${feature.x}, ${feature.z}) but /locate reported not_found`,
  };
}
