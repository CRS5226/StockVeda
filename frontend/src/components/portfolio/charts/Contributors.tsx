import type { SignalRow } from "../../../lib/api";
import { compactRupees, contributors } from "../../../lib/signalInsights";

function Bars({ rows, positive, widest }: { rows: SignalRow[]; positive: boolean; widest: number }) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.symbol} className="grid grid-cols-[64px_1fr_52px] items-center gap-2 text-[11px]">
          <span className="font-semibold truncate">{r.symbol}</span>
          <div className="h-2 rounded bg-slate-100"><div className={`h-full rounded ${positive ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${(Math.abs(r.gain) / widest) * 100}%` }} /></div>
          <span className={`text-right tabular-nums ${positive ? "text-emerald-700" : "text-red-700"}`}>{compactRupees(r.gain)}</span>
        </li>
      ))}
      {rows.length === 0 && <li className="text-[11px] text-slate-400">None</li>}
    </ul>
  );
}

/** The five biggest gains and the five biggest losses in rupees, on one scale. */
export default function Contributors({ rows }: { rows: SignalRow[] }) {
  const { gainers, losers } = contributors(rows, 5);
  const widest = Math.max(...gainers.map((r) => r.gain), ...losers.map((r) => -r.gain), 1);
  return (
    <div className="flex flex-col gap-3">
      <div><div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">Gains</div><Bars rows={gainers} positive widest={widest} /></div>
      <div><div className="text-[10px] font-semibold uppercase tracking-wide text-red-700 mb-1">Losses</div><Bars rows={losers} positive={false} widest={widest} /></div>
    </div>
  );
}
