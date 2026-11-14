import type { HealthReport } from "../../../lib/api";
import { pct } from "../../../lib/healthLabels";
import { rupees } from "../../../lib/formatMoney";

/** The biggest stocks by share of the portfolio, and what it would take to bring those above your limit back to it. */
export default function ConcentrationCheck({ data }: { data: HealthReport["concentration"] }) {
  const top = data.positions.slice(0, 10);
  const widest = Math.max(data.max_pct, ...top.map((p) => p.weight_pct), 1);
  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold">Biggest stocks</h3>
        <p className="text-xs text-slate-500">
          {data.over_limit === 0 ? `No stock is above your ${data.max_pct}% limit.` : `${data.over_limit} ${data.over_limit === 1 ? "stock is" : "stocks are"} above your ${data.max_pct}% limit.`}
        </p>
      </div>
      <div className="p-4 flex flex-col gap-2">
        {top.length === 0 && <div className="text-sm text-slate-400">No priced stocks yet.</div>}
        {top.map((p) => (
          <div key={p.symbol} className="grid grid-cols-[110px_1fr_90px_minmax(120px,auto)] items-center gap-3 text-sm">
            <span className="font-semibold">{p.symbol}</span>
            <div className="relative h-2.5 rounded bg-slate-100">
              <div className={`h-full rounded ${p.over_limit ? "bg-amber-400" : "bg-blue-400"}`} style={{ width: `${(p.weight_pct / widest) * 100}%` }} />
              <div className="absolute top-[-3px] bottom-[-3px] w-px bg-slate-500" style={{ left: `${(data.max_pct / widest) * 100}%` }} title={`Limit ${data.max_pct}%`} />
            </div>
            <span className="tabular-nums text-right">{pct(p.weight_pct)} <span className="text-xs text-slate-400">of total</span></span>
            <span className="text-xs text-slate-500 tabular-nums">
              {p.over_limit ? `Reduce by ${p.shares_to_trim} ${p.shares_to_trim === 1 ? "share" : "shares"} (about ${rupees(p.excess_value)})` : rupees(p.value)}
            </span>
          </div>
        ))}
      </div>
      <p className="px-4 pb-3 text-xs text-slate-400">Top 5 stocks hold {pct(data.top5_pct)} of the portfolio. It behaves like {data.effective_holdings.toFixed(0)} equal-sized holdings.</p>
    </div>
  );
}
