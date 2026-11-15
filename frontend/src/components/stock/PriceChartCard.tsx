import { Calendar } from "lucide-react";
import CandleChart from "../CandleChart";
import { RANGES } from "../../lib/stockFormat";
import type { Candle } from "../../lib/api";
import type { Range } from "../../lib/stockFormat";

/** Range buttons and the candlestick chart. */
export default function PriceChartCard({ range, onRange, candles, loadingCandles }: { range: Range; onRange: (r: Range) => void; candles: Candle[]; loadingCandles: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100">
        <Calendar size={12} className="text-slate-400 mr-1" />
        {RANGES.map((r) => (
          <button key={r} onClick={() => onRange(r)}
            className={`text-xs px-2 py-1 rounded-md transition-colors ${
              range === r ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}>
            {r}
          </button>
        ))}
      </div>
      <CandleChart candles={candles} loading={loadingCandles} />
    </div>
  );
}
