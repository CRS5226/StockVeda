import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SignalFrame, SignalRow, SignalTimeframe } from "../../../lib/api";
import { pct, signedPct } from "../../../lib/healthLabels";
import { matchesFilter, REGIME_LABEL, STATE_ARROW, STATE_LABEL, STATE_STYLE, ZONE_LABEL, ZONE_RANK, ZONE_STYLE, type SignalFilter } from "../../../lib/signalLabels";
import { nextSort, sortRows, type SortState } from "../../../lib/sortRows";
import SortHeader from "../SortHeader";
import SignalDetail from "./SignalDetail";

type SortKey = "symbol" | "weight_pct" | "pnl_pct" | "zone_rank" | "alignment_rank";
type Row = SignalRow & { zone_rank: number; alignment_rank: number };

const FILTERS: { key: SignalFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "profit", label: "Profit-booking zone" }, { key: "recovery", label: "Recovery zone" },
  { key: "bullish", label: "Bullish on all timeframes" }, { key: "bearish", label: "Bearish on all timeframes" },
];
const ALIGN_RANK = { bullish: 0, mixed: 1, bearish: 2 } as const;
const TFS: SignalTimeframe[] = ["1W", "1D", "1H"];

function Lean({ frame }: { frame: SignalFrame | null }) {
  if (!frame) return <span className="text-slate-300">—</span>;
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATE_STYLE[frame.lean]}`}>{STATE_ARROW[frame.lean]} {STATE_LABEL[frame.lean]}</span>;
}

/** One row per stock: the lean of each timeframe, the zone, and a click-through to every rule behind them. */
export default function SignalsTable({ rows, maxPct }: { rows: SignalRow[]; maxPct: number }) {
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>({ key: "zone_rank", dir: "asc" });
  const [open, setOpen] = useState<string | null>(null);
  const data: Row[] = useMemo(() => rows.map((r) => ({ ...r, zone_rank: ZONE_RANK[r.zone], alignment_rank: r.alignment ? ALIGN_RANK[r.alignment] : 3 })), [rows]);
  const shown = useMemo(() => {
    const kept = data.filter((r) => matchesFilter(r, filter));
    return sort ? sortRows(kept, sort.key, sort.dir) : kept;
  }, [data, filter, sort]);
  const onSort = (k: SortKey) => setSort((cur) => nextSort(cur, k));
  const head = (key: SortKey, label: string, right = false) => <SortHeader columnKey={key} label={label} sort={sort} onSort={onSort} right={right} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="font-semibold">Rule scoreboard</h3>
          <p className="text-xs text-slate-500">Click a row to see every rule, the zone conditions and the share arithmetic.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5 text-xs font-medium" role="group" aria-label="Filter the scoreboard">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`px-2.5 py-1 rounded-full border transition-colors ${filter === f.key ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              {f.label} <span className="opacity-60">{data.filter((r) => matchesFilter(r, f.key)).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-xs text-slate-500 text-left">
              <th className="w-8" />{head("symbol", "Stock")}{head("weight_pct", "Weight", true)}{head("pnl_pct", "Profit", true)}
              <th className="px-3 py-2 font-medium">Weekly</th><th className="px-3 py-2 font-medium">Daily</th><th className="px-3 py-2 font-medium">1-hour</th>
              {head("alignment_rank", "Timeframes")}{head("zone_rank", "Zone")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const isOpen = open === r.symbol;
              const daily = r.timeframes["1D"];
              return (
                <Fragment key={r.symbol}>
                  <tr onClick={() => setOpen(isOpen ? null : r.symbol)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" aria-expanded={isOpen}>
                    <td className="pl-3 text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td className="px-3 py-2"><span className="font-semibold">{r.symbol}</span>{daily?.regime && <span className="ml-2 text-[10px] text-slate-400">{REGIME_LABEL[daily.regime]}</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.weight_pct)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.pnl_pct === null ? "text-slate-400" : r.pnl_pct >= 0 ? "text-emerald-600" : "text-red-600"}`}>{signedPct(r.pnl_pct, 0)}</td>
                    {TFS.map((tf) => <td key={tf} className="px-3 py-2"><Lean frame={r.timeframes[tf]} /></td>)}
                    <td className="px-3 py-2 text-xs text-slate-500">{r.alignment === "bullish" ? "All bullish" : r.alignment === "bearish" ? "All bearish" : r.alignment === "mixed" ? "Mixed" : "—"}</td>
                    <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ZONE_STYLE[r.zone]}`}>{ZONE_LABEL[r.zone]}</span></td>
                  </tr>
                  {isOpen && <tr><td colSpan={9} className="p-0"><SignalDetail row={r} maxPct={maxPct} /></td></tr>}
                </Fragment>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">No stock matches this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
