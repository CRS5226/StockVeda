import { fmt } from "../../lib/stockFormat";
import type { Candle, StockRatios } from "../../lib/api";

/** Analyst rating breakdown and the price-target gauge. */
export default function AnalystConsensus({ ratios, last }: { ratios: StockRatios | null; last: Candle | undefined }) {
  return (
    <>
      {/* Analyst Consensus */}
      {ratios?.target_mean != null && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-400 font-medium mb-2">Analyst Consensus</div>
          <div className="flex flex-wrap gap-2 items-center">
            {ratios.recommendation && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${
                ratios.recommendation.includes("buy") ? "bg-emerald-50 text-emerald-700"
                : ratios.recommendation.includes("sell") ? "bg-red-50 text-red-600"
                : "bg-slate-100 text-slate-600"
              }`}>{ratios.recommendation.replace(/_/g, " ")}</span>
            )}
          </div>

          {/* Rating breakdown (current) + trend vs oldest period */}
          {ratios.recommendations_summary && ratios.recommendations_summary.length > 0 && (() => {
            const cur = ratios.recommendations_summary![0];
            const old = ratios.recommendations_summary![ratios.recommendations_summary!.length - 1];
            const total = cur.strongBuy + cur.buy + cur.hold + cur.sell + cur.strongSell || 1;
            // Consensus score in [-1, 1]: strongBuy=+1 … strongSell=-1, weighted by count.
            const score = (s: typeof cur) => {
              const n = s.strongBuy + s.buy + s.hold + s.sell + s.strongSell || 1;
              return (s.strongBuy * 1 + s.buy * 0.5 + s.hold * 0 + s.sell * -0.5 + s.strongSell * -1) / n;
            };
            const delta = score(cur) - score(old);
            const trend = delta > 0.02 ? { t: "▲ improving vs 3m ago", c: "text-emerald-600" }
                        : delta < -0.02 ? { t: "▼ weakening vs 3m ago", c: "text-red-500" }
                        : { t: "→ stable vs 3m ago", c: "text-slate-400" };
            const ROWS: [string, number, string][] = [
              ["Strong Buy",  cur.strongBuy,  "bg-emerald-600"],
              ["Buy",         cur.buy,        "bg-emerald-400"],
              ["Hold",        cur.hold,       "bg-slate-300"],
              ["Sell",        cur.sell,       "bg-red-400"],
              ["Strong Sell", cur.strongSell, "bg-red-600"],
            ];
            return (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400">{total} analysts</span>
                  <span className={`text-xs font-medium ${trend.c}`}>{trend.t}</span>
                </div>
                <div className="flex flex-col gap-1">
                  {ROWS.map(([label, count, color]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${(count / total) * 100}%` }} />
                      </div>
                      <span className="text-xs text-slate-600 w-5 text-right tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Price-target gauge — current price within the low–mean–high range */}
          {last && ratios.target_low != null && ratios.target_high != null && (() => {
            const lo = ratios.target_low!, hi = ratios.target_high!, mean = ratios.target_mean!;
            const now = last.close;
            // Extend the scale so the current price is always visible (it can sit below "low").
            const sMin = Math.min(lo, now), sMax = Math.max(hi, now);
            const span = sMax - sMin || 1;
            const pos = (v: number) => Math.min(100, Math.max(0, ((v - sMin) / span) * 100));
            return (
              <div className="mt-3">
                <div className="text-xs text-slate-400 font-medium mb-2">Price target</div>
                <div className="relative h-2 bg-slate-100 rounded-full mb-1">
                  {/* analyst low→high band */}
                  <div className="absolute inset-y-0 bg-emerald-200 rounded-full"
                    style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
                  {/* mean target marker */}
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-4 bg-emerald-600 rounded"
                    style={{ left: `${pos(mean)}%` }} title={`Mean ₹${fmt(mean)}`} />
                  {/* current price marker */}
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow"
                    style={{ left: `${pos(now)}%` }} title={`Now ₹${fmt(now)}`} />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-blue-600 font-medium">now ₹{fmt(now)}</span>
                  <span className="text-slate-500">
                    mean <span className="font-medium text-slate-700">₹{fmt(mean)}</span>{" "}
                    <span className={mean > now ? "text-emerald-600" : "text-red-500"}>
                      {mean > now ? "▲" : "▼"} {Math.abs(((mean - now) / now) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                  <span>low ₹{fmt(lo)}</span>
                  <span>high ₹{fmt(hi)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}
