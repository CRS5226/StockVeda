// Pure helpers for mirroring the crosshair between two charts whose bars may be on different timeframes.

import type { Time } from "lightweight-charts";

/** Seconds since the epoch of a chart time: a `YYYY-MM-DD` string (daily bars) or a timestamp (intraday). */
export function chartTimeToEpoch(t: Time): number | null {
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const ms = Date.parse(`${t}T00:00:00Z`);
    return Number.isNaN(ms) ? null : ms / 1000;
  }
  return null;
}

/** Index of the last bar at or before `epoch` (bars sorted by time), or -1 when the chart starts later. */
export function barAtOrBefore(epochs: number[], epoch: number): number {
  let lo = 0, hi = epochs.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (epochs[mid] <= epoch) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
