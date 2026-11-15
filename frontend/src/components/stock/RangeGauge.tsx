import { fmt } from "../../lib/stockFormat";
import type { Candle, StockRatios } from "../../lib/api";

/** Where the price sits in its 52-week range. */
export default function RangeGauge({ ratios, last }: { ratios: StockRatios | null; last: Candle | undefined }) {
  return (
    <>
      {/* 52-Week Range Gauge */}
      {ratios?.["52w_high"] != null && ratios?.["52w_low"] != null && last && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-400 font-medium mb-2">52-Week Range</div>
          {(() => {
            const lo = ratios["52w_low"]!;
            const hi = ratios["52w_high"]!;
            const pct = Math.min(100, Math.max(0, ((last.close - lo) / (hi - lo)) * 100));
            return (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-16 text-right shrink-0">₹{fmt(lo, 0)}</span>
                <div className="relative flex-1 h-1.5 bg-slate-200 rounded-full">
                  <div className="absolute inset-y-0 left-0 bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow" style={{ left: `${pct}%` }} />
                </div>
                <span className="text-xs text-slate-500 w-16 shrink-0">₹{fmt(hi, 0)}</span>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}
