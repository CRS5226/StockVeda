import { useMemo } from "react";
import type { SignalRow } from "../../../lib/api";
import { pnlColor } from "../../../lib/signalInsights";
import { treemap } from "../../../lib/treemap";

const W = 160, H = 90;          // layout box; the tiles are drawn as percentages of it, so the map fills its container

/** Every stock as a tile: area is its share of the stock holdings, colour is its profit or loss. */
export default function HeatMap({ rows }: { rows: SignalRow[] }) {
  const tiles = useMemo(() => {
    const by = new Map(rows.map((r) => [r.symbol, r]));
    return treemap(rows.map((r) => ({ id: r.symbol, value: r.value })), W, H).map((t) => ({ ...t, row: by.get(t.id)! }));
  }, [rows]);
  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: `${W} / ${H}` }} role="img" aria-label="Heat map of the stock holdings">
        {tiles.map(({ id, x, y, w, h, row }) => {
          const big = w * h > 90, medium = w * h > 40;
          return (
            <div key={id} className="absolute border border-white/70 flex flex-col items-center justify-center overflow-hidden text-slate-900"
              style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%`, background: pnlColor(row.pnl_pct) }}
              title={`${id}: ${row.weight_pct.toFixed(1)}% of stocks, ${row.pnl_pct === null ? "no profit figure" : `${row.pnl_pct >= 0 ? "+" : ""}${row.pnl_pct.toFixed(0)}%`}`}>
              {medium && <span className={`font-semibold leading-none truncate max-w-full px-0.5 ${big ? "text-[11px]" : "text-[8px]"}`}>{id}</span>}
              {big && row.pnl_pct !== null && <span className="text-[9px] leading-none mt-0.5 opacity-80">{row.pnl_pct >= 0 ? "+" : ""}{row.pnl_pct.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
        <span>−50%</span>
        <span className="h-1.5 w-28 rounded" style={{ background: `linear-gradient(90deg, ${pnlColor(-50)}, ${pnlColor(0)}, ${pnlColor(50)})` }} />
        <span>+50%</span>
        <span className="ml-auto">size = share of stocks</span>
      </div>
    </div>
  );
}
