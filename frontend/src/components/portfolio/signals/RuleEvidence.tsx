import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RuleEvidenceReport, RuleResult } from "../../../lib/api";
import { heldUpCount, summaryLine, VERDICT_HINT, VERDICT_LABEL, VERDICT_STYLE } from "../../../lib/evidenceLabels";
import { pct, signedPct } from "../../../lib/healthLabels";
import { nextSort, sortRows, type SortState } from "../../../lib/sortRows";
import { usePortfolioEvidence } from "../../../lib/usePortfolioEvidence";
import SortHeader from "../SortHeader";

type SortKey = "symbol" | "weight_pct" | "held_up";
const tone = (n: number | null) => (n === null ? "text-slate-400" : n >= 0 ? "text-emerald-600" : "text-red-600");

function Numbers({ r, rule }: { r: RuleResult; rule: { label: string; how: string } }) {
  return (
    <div className="border border-slate-200 bg-white rounded-lg p-3 text-xs flex flex-col gap-1">
      <div className="font-medium text-sm">{rule.label}</div>
      <div className="text-slate-400">{rule.how}</div>
      <div className="mt-1">{r.trades} {r.trades === 1 ? "trade" : "trades"}{r.win_rate_pct !== null && <>, {r.win_rate_pct.toFixed(0)}% won, {signedPct(r.avg_trade_pct)} on average</>}{r.avg_days_in_trade !== null && <>, about {r.avg_days_in_trade.toFixed(0)} days each</>}</div>
      <div>All {r.candles} candles: <b className={tone(r.total_pct)}>{signedPct(r.total_pct)}</b> <span className="text-slate-400">(just holding: {signedPct(r.buy_hold_pct)})</span></div>
      <div>Earlier part: <b className={tone(r.earlier_pct)}>{signedPct(r.earlier_pct)}</b> · later part: <b className={tone(r.later_pct)}>{signedPct(r.later_pct)}</b> <span className="text-slate-400">(holding: {signedPct(r.later_buy_hold_pct)})</span></div>
      <div className="text-slate-400">In the stock {r.in_market_pct.toFixed(0)}% of the time · worst fall {pct(r.max_drawdown_pct)}</div>
    </div>
  );
}

/**
 * How each indicator rule would have done on each stock's own history, after costs. Fixed standard parameters, long only,
 * nothing tuned. A record of the past that helps read the Signals scoreboard, not a forecast.
 */
export default function RuleEvidence({ portfolioId }: { portfolioId: number }) {
  const [cost, setCost] = useState("0.2");
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<SortKey> | null>({ key: "weight_pct", dir: "desc" });
  const costNumber = Number.isFinite(Number(cost)) && Number(cost) >= 0 && Number(cost) <= 5 ? Number(cost) : 0.2;
  const { report, error, loading } = usePortfolioEvidence(portfolioId, costNumber);

  const rows = useMemo(() => (report?.rows ?? []).map((r) => ({ ...r, held_up: heldUpCount(r.results) })), [report]);
  const shown = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir) : rows), [rows, sort]);
  const onSort = (k: SortKey) => setSort((cur) => nextSort(cur, k));
  const ruleOf = (key: string) => report?.rules.find((x) => x.key === key);

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="font-semibold">Rule evidence</h3>
          <p className="text-xs text-slate-500">How each rule would have done on each stock's own daily history, after costs. A record of the past, not a forecast.</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500" title="Brokerage, taxes and a little slippage, charged on each side of every trade">
          Cost per side (%)
          <input className="w-16 px-2 py-1 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400" type="number" min={0} max={5} step="0.05" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>
      {error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      {!report ? <div className="py-10 text-center text-sm text-slate-400">{loading ? "Testing the rules…" : "Nothing to show."}</div> : (
        <>
          <div className={`p-4 grid gap-3 md:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
            {report.summary.map((s) => (
              <div key={s.key} className="border border-slate-200 rounded-lg p-3">
                <div className="font-medium text-sm">{ruleOf(s.key)?.label}</div>
                <div className="text-xs text-slate-400">{ruleOf(s.key)?.how}</div>
                <div className="mt-2 text-sm font-semibold">{summaryLine(s)}</div>
                <div className="text-xs text-slate-500 tabular-nums">{s.mixed} mixed · {s.did_not} did not · {s.few_trades} too few trades</div>
                <div className="text-xs text-slate-500 tabular-nums">Later part, middle stock: <b className={tone(s.median_later_pct)}>{signedPct(s.median_later_pct)}</b> · beat just holding on {s.beat_buy_hold_later}</div>
              </div>
            ))}
          </div>
          <div className={`overflow-x-auto max-h-[520px] overflow-y-auto ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-xs text-slate-500 text-left">
                  <th className="w-8" />
                  <SortHeader columnKey="symbol" label="Stock" sort={sort} onSort={onSort} />
                  <SortHeader columnKey="weight_pct" label="Weight" sort={sort} onSort={onSort} right />
                  <SortHeader columnKey="held_up" label="Rules held up" sort={sort} onSort={onSort} right />
                  {report.rules.map((r) => <th key={r.key} className="px-2 py-2 font-medium text-center" title={r.how}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const isOpen = open === row.symbol;
                  return (
                    <Fragment key={row.symbol}>
                      <tr onClick={() => setOpen(isOpen ? null : row.symbol)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" aria-expanded={isOpen}>
                        <td className="pl-3 text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="px-3 py-2 font-semibold">{row.symbol}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(row.weight_pct)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.held_up} of {report.rules.length}</td>
                        {report.rules.map((r) => {
                          const res = row.results[r.key];
                          return (
                            <td key={r.key} className="px-2 py-2 text-center">
                              {res ? <span title={VERDICT_HINT[res.verdict]} className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${VERDICT_STYLE[res.verdict]}`}>{VERDICT_LABEL[res.verdict]}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={4 + report.rules.length} className="p-0">
                          <div className="p-4 bg-slate-50 border-t border-slate-100 grid gap-3 lg:grid-cols-3">
                            {report.rules.map((r) => { const res = row.results[r.key]; return res ? <Numbers key={r.key} r={res} rule={r} /> : null; })}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-100">
            Tested on {report.rows.length} of {report.stocks_total} stocks that have enough stored candles. "Earlier" is the first 60% of the tested candles, "later" the last 40%. Each rule uses its standard settings, goes long only, and acts on the next candle. {report.cost_pct}% is charged on each side. Rules with fewer than 5 trades are marked too few. Past results of simple rules often do not repeat.
          </p>
        </>
      )}
    </div>
  );
}
