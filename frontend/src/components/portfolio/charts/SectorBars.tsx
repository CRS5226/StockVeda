import type { SignalRow } from "../../../lib/api";
import { sectorSplit } from "../../../lib/signalInsights";

/** Share of the stock holdings by sector (from the synced valuation ratios); stocks without one are grouped by what they are. */
export default function SectorBars({ rows }: { rows: SignalRow[] }) {
  const split = sectorSplit(rows);
  const total = split.reduce((a, s) => a + s.value, 0) || 1;
  const widest = Math.max(...split.map((s) => s.value / total * 100), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {split.map((s) => (
        <li key={s.label} className="grid grid-cols-[110px_1fr_38px] items-center gap-2 text-[11px]" title={`${s.count} ${s.count === 1 ? "holding" : "holdings"}`}>
          <span className="truncate text-slate-600">{s.label}</span>
          <div className="h-2 rounded bg-slate-100"><div className="h-full rounded bg-blue-400" style={{ width: `${((s.value / total) * 100 / widest) * 100}%` }} /></div>
          <span className="text-right tabular-nums font-semibold">{((s.value / total) * 100).toFixed(0)}%</span>
        </li>
      ))}
    </ul>
  );
}
