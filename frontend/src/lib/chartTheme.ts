export type ChartTheme = "light" | "dark";

export interface ChartPalette {
  background: string;
  grid: string;
  text: string;
  border: string;
  crosshair: string;
}

export const PALETTES: Record<ChartTheme, ChartPalette> = {
  light: { background: "#ffffff", grid: "#f1f5f9", text: "#64748b", border: "#e2e8f0", crosshair: "#94a3b8" },
  dark:  { background: "#131722", grid: "#1e222d", text: "#9aa4b2", border: "#2a2e39", crosshair: "#758696" },
};

const STORAGE_KEY = "stockveda.charts.theme";

/** Saved theme choice for the Charts page; storage can be blocked, so fall back to light. */
export function loadChartTheme(): ChartTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveChartTheme(theme: ChartTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}
