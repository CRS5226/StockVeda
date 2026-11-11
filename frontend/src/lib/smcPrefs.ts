import { NO_SMC, type SmcToggles } from "../components/BacktestChart";
import { DEFAULT_SWING_LENGTH } from "./smcSwingStructure";

const STORAGE_KEY = "stockveda.charts.smc";

// BOS and ChoCH on by default, so the first SMC open already shows something on the chart.
export const DEFAULT_CHART_SMC: SmcToggles = { ...NO_SMC, bos: true, choch: true };

/** Last SMC selection on the Charts page. Unknown or malformed storage falls back to the default. */
export function loadSmcPrefs(): SmcToggles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_SMC;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const next: SmcToggles = { ...NO_SMC };
    for (const key of Object.keys(NO_SMC) as (keyof SmcToggles)[]) {
      if (typeof saved[key] === "boolean") next[key] = saved[key] as boolean;
    }
    next.idm = false; // the Charts page has no IDM (a lecture-rules concept); drop it from older saved choices
    return next;
  } catch {
    return DEFAULT_CHART_SMC;
  }
}

export function saveSmcPrefs(smc: SmcToggles): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(smc));
  } catch {
    /* storage unavailable: the selection just won't persist */
  }
}

export interface StructureSettings { length: number }

const STRUCTURE_KEY = "stockveda.charts.structure";
export const DEFAULT_STRUCTURE: StructureSettings = { length: DEFAULT_SWING_LENGTH };

export function loadStructureSettings(): StructureSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STRUCTURE_KEY) ?? "null") as Partial<StructureSettings> | null;
    const length = Number(saved?.length);
    return { length: Number.isInteger(length) && length >= 1 && length <= 20 ? length : DEFAULT_STRUCTURE.length };
  } catch {
    return DEFAULT_STRUCTURE;
  }
}

export function saveStructureSettings(s: StructureSettings): void {
  try {
    localStorage.setItem(STRUCTURE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}
