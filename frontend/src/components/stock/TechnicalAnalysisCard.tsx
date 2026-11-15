import TrendOutlook, { type OutlookData } from "../TrendOutlook";
import type { Candle } from "../../lib/api";
import type { PatternHit } from "../../lib/candlePatterns";

/** Recent candle patterns and the trend outlook. */
const CANDLE_BARS: Record<string, number> = {
  MS: 3, ES: 3, "3W": 3, "3B": 3,
  E: 2, BE: 2, P: 2, DC: 2,
  H: 1, IH: 1, SS: 1, DD: 1, GD: 1, M: 1,
};

export default function TechnicalAnalysisCard({ sym, candles, patternHits, outlook, outlookLoading, last }: {
  sym: string;
  candles: Candle[];
  patternHits: PatternHit[];
  outlook: OutlookData | null;
  outlookLoading: boolean;
  last: Candle | undefined;
}) {
  // Last 10 trading days from candle data for pattern filter
  const last10Dates = new Set(candles.slice(-10).map(c => c.date.slice(0, 10)));
  const recentPatterns = patternHits
    .filter(h => last10Dates.size === 0 || last10Dates.has(h.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mt-4">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Technical Analysis</span>
        <span className="text-[10px] text-slate-400">Candle patterns · last 10 trading days</span>
      </div>
      <div className="flex divide-x divide-slate-100">
        {/* Patterns column */}
        <div className="flex-1 p-3 space-y-1.5">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Recent Patterns</div>
          {recentPatterns.length === 0 ? (
            <div className="text-[10px] text-slate-400 py-4 text-center">No patterns in last 10 trading days</div>
          ) : (
            recentPatterns.map((p, i) => {
              const bars = CANDLE_BARS[p.label] ?? 1;
              return (
                <div key={i} className={`px-2 py-1.5 rounded-lg border ${
                  p.bias === "bullish" ? "bg-purple-50 border-purple-100" : "bg-fuchsia-50 border-fuchsia-100"
                }`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`font-bold text-[11px] ${p.bias === "bullish" ? "text-purple-600" : "text-fuchsia-600"}`}>{p.label}</span>
                    <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1">{bars}-bar</span>
                    <span className={`ml-auto text-xs ${p.bias === "bullish" ? "text-purple-400" : "text-fuchsia-400"}`}>
                      {p.bias === "bullish" ? "↑" : "↓"}
                    </span>
                  </div>
                  <div className={`text-[10px] font-semibold ${p.bias === "bullish" ? "text-purple-700" : "text-fuchsia-700"}`}>{p.date}</div>
                  <div className="text-slate-500 text-[9px] leading-tight mt-0.5">{p.tip}</div>
                </div>
              );
            })
          )}
        </div>
        {/* Trend Outlook column */}
        <div className="flex-1 p-3">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Trend Outlook</div>
          <TrendOutlook symbol={sym} data={outlook} loading={outlookLoading} sidebar lastCandle={last} />
        </div>
      </div>
    </div>
  );
}
