import { ArrowUpRight, ArrowDownRight, Calendar } from "lucide-react";
import { fmt } from "../../lib/stockFormat";
import type { Candle, StockRatios } from "../../lib/api";

/** Symbol, price, day change and the day's range. */
export default function StockInfoCard({ sym, stockInfo, ratios, last, change, changePct, up, high52, low52, loadingCandles }: {
  sym: string;
  stockInfo: { company_name: string | null; isin: string | null } | null;
  ratios: StockRatios | null;
  last: Candle | undefined;
  change: number;
  changePct: number;
  up: boolean;
  high52: number | null;
  low52: number | null;
  loadingCandles: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-2xl font-bold text-slate-800">{sym}</span>
            {stockInfo?.isin && (
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{stockInfo.isin}</span>
            )}
            {ratios?.next_earnings && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                <Calendar size={10} /> Next earnings: {ratios.next_earnings}
              </span>
            )}
          </div>
          {stockInfo?.company_name && (
            <div className="text-sm text-slate-500 mb-2">{stockInfo.company_name}</div>
          )}
          {last && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900">₹{fmt(last.close)}</span>
              <span className={`flex items-center gap-0.5 text-sm font-semibold ${up ? "text-emerald-600" : "text-red-500"}`}>
                {up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                {up ? "+" : ""}{fmt(change)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
        {loadingCandles && (
          <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mt-1" />
        )}
      </div>

      {last && (
        <>
          <div className="grid grid-cols-3 gap-3 text-xs mt-3 pt-3 border-t border-slate-100">
            {[["Open", `₹${fmt(last.open)}`], ["High", `₹${fmt(last.high)}`], ["Low", `₹${fmt(last.low)}`],
              ["Volume", last.volume?.toLocaleString("en-IN") ?? "—"],
              ["52W High", high52 ? `₹${fmt(high52)}` : "—"],
              ["52W Low",  low52  ? `₹${fmt(low52)}`  : "—"],
            ].map(([l, v]) => (
              <div key={l}>
                <span className="block text-slate-400 mb-0.5">{l}</span>
                <span className="font-medium text-slate-700">{v}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-100">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-xs text-slate-400">NSE EOD · data as of {last.date}</span>
          </div>
        </>
      )}
    </div>
  );
}
