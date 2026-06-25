import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface OutlookData {
  score: number;
  label: string;
  components: Record<string, number>;
  indicators: { rsi: number; macd_hist: number | null; sma20_diff_pct: number | null; close: number };
  recent_patterns: string[];
  pattern_stats: {
    pattern: string; label: string; name: string; occurrences: number;
    up5d_pct: number; up10d_pct: number; up20d_pct: number; avg_move5d: number;
  }[];
}

interface Props {
  symbol: string;
  data: OutlookData | null;
  loading?: boolean;
}

const LABEL_COLOR: Record<string, string> = {
  "Bullish":      "#16a34a",
  "Mild Bullish": "#22c55e",
  "Neutral":      "#64748b",
  "Mild Bearish": "#f59e0b",
  "Bearish":      "#ef4444",
};

const COMPONENT_LABELS: Record<string, string> = {
  rsi:      "RSI(14)",
  macd:     "MACD",
  sma20:    "SMA 20",
  sma50:    "SMA 50",
  volume:   "Volume",
  patterns: "Patterns",
};

function ScoreBar({ score }: { score: number }) {
  const pct = ((score + 8) / 16) * 100;
  const color = score >= 4 ? "#16a34a" : score >= 2 ? "#22c55e" : score >= -1 ? "#94a3b8" : score >= -3 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300 z-10" />
      <div
        className="absolute inset-y-0 rounded-full transition-all duration-500"
        style={{
          left:  score >= 0 ? "50%" : `${pct}%`,
          right: score < 0  ? "50%" : `${100 - pct}%`,
          background: color,
        }}
      />
    </div>
  );
}

function WinPctCell({ pct }: { pct: number }) {
  const color = pct >= 60 ? "text-emerald-600 font-semibold" : pct >= 50 ? "text-emerald-500" : pct >= 40 ? "text-amber-500" : "text-red-400";
  return <td className={`px-3 py-2 text-center text-xs ${color}`}>{pct}%</td>;
}

export default function TrendOutlook({ symbol, data, loading }: Props) {
  const [open, setOpen] = useState(false);

  if (!data && !loading) return null;

  const labelColor = data ? (LABEL_COLOR[data.label] ?? "#64748b") : "#64748b";

  return (
    <div className="border-t border-slate-100">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
      >
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Trend Outlook</span>
        {loading && <span className="text-[10px] text-slate-400 animate-pulse">Loading…</span>}
        {data && !loading && (
          <>
            <ScoreBar score={data.score} />
            <span className="text-xs font-bold shrink-0" style={{ color: labelColor }}>{data.label}</span>
            <span className="text-[10px] text-slate-400 shrink-0">score {data.score > 0 ? "+" : ""}{data.score}/8</span>
          </>
        )}
        <ChevronDown size={12} className={`text-slate-400 ml-auto shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && data && (
        <div className="px-4 pb-4 space-y-4">
          {/* Component breakdown */}
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Signal Breakdown</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {Object.entries(data.components).map(([key, val]) => {
                const score = val;
                const isPos = score > 0;
                const isNeg = score < 0;
                const bg = isPos ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                         : isNeg ? "bg-red-50 border-red-100 text-red-600"
                         : "bg-slate-50 border-slate-100 text-slate-500";
                const hint = key === "rsi" ? `RSI ${data.indicators.rsi}`
                           : key === "sma20" ? `${data.indicators.sma20_diff_pct !== null ? (data.indicators.sma20_diff_pct >= 0 ? "+" : "") + data.indicators.sma20_diff_pct + "% vs SMA20" : ""}`
                           : key === "macd" ? (data.indicators.macd_hist !== null ? `hist ${data.indicators.macd_hist > 0 ? "+" : ""}${data.indicators.macd_hist.toFixed(2)}` : "")
                           : key === "patterns" && data.recent_patterns.length > 0 ? data.recent_patterns.join(", ")
                           : "";
                return (
                  <div key={key} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs ${bg}`}>
                    <div>
                      <div className="font-medium">{COMPONENT_LABELS[key] ?? key}</div>
                      {hint && <div className="text-[10px] opacity-70">{hint}</div>}
                    </div>
                    <span className="font-bold text-sm">{score > 0 ? "+" : ""}{score}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical pattern stats */}
          {data.pattern_stats.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Historical Pattern Win Rate — based on this stock's own data
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-[10px]">
                      <th className="px-3 py-1.5 text-left font-semibold">Pattern</th>
                      <th className="px-3 py-1.5 text-center font-semibold">Occurrences</th>
                      <th className="px-3 py-1.5 text-center font-semibold">Up 5d</th>
                      <th className="px-3 py-1.5 text-center font-semibold">Up 10d</th>
                      <th className="px-3 py-1.5 text-center font-semibold">Up 20d</th>
                      <th className="px-3 py-1.5 text-center font-semibold">Avg Move 5d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pattern_stats.map((ps) => (
                      <tr key={ps.pattern} className="border-t border-slate-50 hover:bg-slate-50/50">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-700">{ps.name}</div>
                          <div className="text-[10px] text-slate-400">{ps.label}</div>
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">{ps.occurrences}</td>
                        <WinPctCell pct={ps.up5d_pct} />
                        <WinPctCell pct={ps.up10d_pct} />
                        <WinPctCell pct={ps.up20d_pct} />
                        <td className={`px-3 py-2 text-center text-xs font-semibold ${ps.avg_move5d >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {ps.avg_move5d >= 0 ? "+" : ""}{ps.avg_move5d}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-slate-300 mt-1.5">
                Win rate = % of past {symbol} occurrences where close was higher at that horizon · not a guarantee
              </div>
            </div>
          )}

          {data.pattern_stats.length === 0 && (
            <div className="text-[10px] text-slate-400 text-center py-2">
              No recent patterns detected — win-rate stats unavailable
            </div>
          )}
        </div>
      )}
    </div>
  );
}
