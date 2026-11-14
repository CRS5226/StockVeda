import { useMemo, useState } from "react";
import type { HealthTrend } from "../../../lib/api";
import { pct, signedPct } from "../../../lib/healthLabels";
import { nextSort, sortRows, type SortState } from "../../../lib/sortRows";
import { rupees } from "../../../lib/formatMoney";
import SortHeader from "../SortHeader";

type SortKey = "symbol" | "weight_pct" | "last" | "vs50" | "vs200" | "from_high_pct" | "return_1y_pct";
type Row = HealthTrend & { vs50: number | null; vs200: number | null };
type Filter = "all" | "below200" | "below50" | "deep";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "below200", label: "Below 200-day" }, { key: "below50", label: "Below 50-day" }, { key: "deep", label: "Far from 52-week high" },
];
const gap = (last: number | null, avg: number | null) => (last !== null && avg ? (last / avg - 1) * 100 : null);
const tone = (n: number | null) => (n === null ? "text-slate-400" : n >= 0 ? "text-emerald-600" : "text-red-600");

/** Where each stock stands against its 50 and 200-day averages and its 52-week high. A fact about the price, not a forecast. */
export default function TrendCheck({ trend }: { trend: HealthTrend[] }) {
  const [sort, setSort] = useState<SortState<SortKey> | null>({ key: "from_high_pct", dir: "asc" });
  const [filter, setFilter] = useState<Filter>("all");
  const rows: Row[] = useMemo(() => trend.map((t) => ({ ...t, vs50: gap(t.last, t.sma50), vs200: gap(t.last, t.sma200) })), [trend]);
  const shown = useMemo(() => {
    const kept = rows.filter((r) => filter === "all" || (filter === "below200" && r.above_sma200 === false) || (filter === "below50" && r.above_sma50 === false) || (filter === "deep" && r.deep_drawdown));
    return sort ? sortRows(kept, sort.key, sort.dir) : kept;
  }, [rows, filter, sort]);
  const onSort = (k: SortKey) => setSort((cur) => nextSort(cur, k));
  const count = (f: Filter) => rows.filter((r) => f === "all" || (f === "below200" && r.above_sma200 === false) || (f === "below50" && r.above_sma50 === false) || (f === "deep" && r.deep_drawdown)).length;
  const head = (key: SortKey, label: string, right = true) => <SortHeader columnKey={key} label={label} sort={sort} onSort={onSort} right={right} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="font-semibold">Price trend of each stock</h3>
          <p className="text-xs text-slate-500">Latest close against its 50 and 200-day averages and its 52-week high.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5 text-xs font-medium" role="group" aria-label="Filter the trend table">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`px-2.5 py-1 rounded-full border transition-colors ${filter === f.key ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              {f.label} <span className="opacity-60">{count(f.key)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-xs text-slate-500 text-left">
              {head("symbol", "Stock", false)}{head("weight_pct", "Weight")}{head("last", "Last close")}{head("vs50", "vs 50-day")}{head("vs200", "vs 200-day")}
              {head("from_high_pct", "From 52-week high")}{head("return_1y_pct", "1-year return")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.symbol} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold">{r.symbol}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.weight_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.last === null ? "—" : rupees(r.last)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.vs50)}`} title={r.sma50 === null ? "Needs 50 days of prices" : `50-day average ${rupees(r.sma50)}`}>{signedPct(r.vs50)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.vs200)}`} title={r.sma200 === null ? "Needs 200 days of prices" : `200-day average ${rupees(r.sma200)}`}>{signedPct(r.vs200)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.deep_drawdown ? "text-red-600 font-semibold" : "text-slate-600"}`}>{signedPct(r.from_high_pct)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.return_1y_pct)}`} title={r.return_1y_pct === null ? "Needs a year of prices" : undefined}>{signedPct(r.return_1y_pct)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">No stock matches this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
