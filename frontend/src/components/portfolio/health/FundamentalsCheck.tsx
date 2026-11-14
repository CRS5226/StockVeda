import { useMemo, useState } from "react";
import type { PortfolioFundamentalsRow } from "../../../lib/api";
import { pct, signedPct } from "../../../lib/healthLabels";
import { nextSort, sortRows, type SortState } from "../../../lib/sortRows";
import SortHeader from "../SortHeader";

type SortKey = "symbol" | "sector" | "pe" | "pb" | "roe_pct" | "debt_to_equity" | "profit_margin_pct" | "dividend_yield_pct" | "revenue_yoy" | "pat_yoy";
type Row = PortfolioFundamentalsRow & { revenue_yoy: number | null; pat_yoy: number | null };

const num = (n: number | null, digits = 1) => (n === null ? "—" : n.toFixed(digits));
const tone = (n: number | null) => (n === null ? "text-slate-400" : n >= 0 ? "text-emerald-600" : "text-red-600");

/** Valuation and results per stock from the stored snapshots. Numbers as reported; they are not a verdict on the stock. */
export default function FundamentalsCheck({ rows }: { rows: PortfolioFundamentalsRow[] }) {
  const [sort, setSort] = useState<SortState<SortKey> | null>({ key: "symbol", dir: "asc" });
  const data: Row[] = useMemo(() => rows.map((r) => ({ ...r, revenue_yoy: r.quarter?.revenue_yoy_pct ?? null, pat_yoy: r.quarter?.pat_yoy_pct ?? null })), [rows]);
  const shown = useMemo(() => (sort ? sortRows(data, sort.key, sort.dir) : data), [data, sort]);
  const onSort = (k: SortKey) => setSort((cur) => nextSort(cur, k));
  const head = (key: SortKey, label: string, right = true) => <SortHeader columnKey={key} label={label} sort={sort} onSort={onSort} right={right} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold">Valuation and results</h3>
        <p className="text-xs text-slate-500">Ratios as Yahoo reports them, and the newest quarter's change over the same quarter a year earlier.</p>
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">Nothing stored yet. Press Sync data above to fetch it for your stocks.</div>
      ) : (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-xs text-slate-500 text-left">
                {head("symbol", "Stock", false)}{head("sector", "Sector", false)}{head("pe", "PE")}{head("pb", "PB")}{head("roe_pct", "ROE")}
                {head("debt_to_equity", "Debt / equity")}{head("profit_margin_pct", "Profit margin")}{head("dividend_yield_pct", "Dividend yield")}
                {head("revenue_yoy", "Revenue vs last year")}{head("pat_yoy", "Profit vs last year")}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.symbol} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{r.symbol}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.sector ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.pe)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.pb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.roe_pct === null ? "—" : pct(r.roe_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.debt_to_equity, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.profit_margin_pct === null ? "—" : pct(r.profit_margin_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.dividend_yield_pct === null ? "—" : pct(r.dividend_yield_pct, 2)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone(r.revenue_yoy)}`} title={r.quarter ? `Quarter ended ${r.quarter.period}` : undefined}>{signedPct(r.revenue_yoy)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone(r.pat_yoy)}`} title={r.quarter ? `Quarter ended ${r.quarter.period}` : undefined}>{signedPct(r.pat_yoy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
