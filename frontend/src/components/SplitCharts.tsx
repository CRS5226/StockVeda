import { useState } from "react";
import ChartPane, { type PaneSetting } from "./ChartPane";
import SmcFloatingBox from "./SmcFloatingBox";
import type { SmcToggles } from "./BacktestChart";
import { useCrosshairSync } from "../lib/useCrosshairSync";
import type { ChartTheme } from "../lib/chartTheme";
import type { StructureSettings } from "../lib/smcPrefs";

interface Props {
  symbol: string;
  tf: string;
  theme: ChartTheme;
  smc: SmcToggles;
  onSmc: (next: SmcToggles) => void;
  smcOpen: boolean;
  onSmcClose: () => void;
  structure: StructureSettings;
  onStructure: (next: StructureSettings) => void;
}

/** Two charts side by side, each with its own symbol and timeframe; the crosshair follows between them. */
export default function SplitCharts({ symbol, tf, theme, smc, onSmc, smcOpen, onSmcClose, structure, onStructure }: Props) {
  const [panes, setPanes] = useState<[PaneSetting, PaneSetting]>([
    { symbol, tf },
    { symbol, tf: tf === "1m" ? "5m" : "1m" },
  ]);
  const sync = useCrosshairSync();
  const dark = theme === "dark";
  const set = (i: 0 | 1) => (next: PaneSetting) => setPanes((p) => (i === 0 ? [next, p[1]] : [p[0], next]));

  return (
    <div className="relative flex flex-1 min-h-0">
      {([0, 1] as const).map((i) => (
        <div key={i} className={`flex flex-1 min-w-0 ${i === 1 ? `border-l ${dark ? "border-[#2a2e39]" : "border-slate-200"}` : ""}`}>
          <ChartPane setting={panes[i]} onChange={set(i)} smc={smc} swingLength={structure.length} theme={theme}
            onChart={(h) => sync.register(i, h)} onBars={(b) => sync.setBars(i, b)} />
        </div>
      ))}
      {smcOpen && <SmcFloatingBox smc={smc} onChange={onSmc} onClose={onSmcClose} dark={dark}
        structure={structure} onStructureChange={onStructure} />}
    </div>
  );
}
