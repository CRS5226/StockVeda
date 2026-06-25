import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface OutlookData {
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
  /** When true: always expanded, no toggle button, compact column layout */
  sidebar?: boolean;
}

const LABEL_COLOR: Record<string, string> = {
  "Bullish":      "#16a34a",
  "Mild Bullish": "#22c55e",
  "Neutral":      "#64748b",
  "Mild Bearish": "#f59e0b",
  "Bearish":      "#ef4444",
};

const COMPONENT_LABELS: Record<string, string> = {
  rsi: "RSI(14)", macd: "MACD", sma20: "SMA 20", sma50: "SMA 50", volume: "Volume", patterns: "Patterns",
};

function ScoreBar({ score }: { score: number }) {
  const pct = ((score + 8) / 16) * 100;
  const color = score >= 4 ? "#16a34a" : score >= 2 ? "#22c55e" : score >= -1 ? "#94a3b8" : score >= -3 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300 z-10" />
      <div className="absolute inset-y-0 rounded-full transition-all duration-500"
        style={{ left: score >= 0 ? "50%" : `${pct}%`, right: score < 0 ? "50%" : `${100 - pct}%`, background: color }} />
    </div>
  );
}

function WinPct({ pct }: { pct: number }) {
  const cls = pct >= 60 ? "text-emerald-600 font-semibold" : pct >= 50 ? "text-emerald-500" : pct >= 40 ? "text-amber-500" : "text-red-400";
  return <span className={`text-[11px] ${cls}`}>{pct}%</span>;
}

function Body({ symbol, data }: { symbol: string; data: OutlookData }) {
  return (
    <div className="space-y-3">
      {/* Score row */}
      <div className="flex items-center gap-2">
        <ScoreBar score={data.score} />
        <span className="text-xs font-bold shrink-0" style={{ color: LABEL_COLOR[data.label] ?? "#64748b" }}>{data.label}</span>
      </div>

      {/* Component breakdown */}
      <div>
        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Signal Breakdown</div>
        <div className="space-y-1">
          {Object.entries(data.components).map(([key, val]) => {
            const isPos = val > 0; const isNeg = val < 0;
            const barColor = isPos ? "#22c55e" : isNeg ? "#ef4444" : "#94a3b8";
            const hint = key === "rsi" ? `${data.indicators.rsi}`
              : key === "sma20" && data.indicators.sma20_diff_pct != null ? `${data.indicators.sma20_diff_pct >= 0 ? "+" : ""}${data.indicators.sma20_diff_pct}% vs SMA20`
              : key === "macd" && data.indicators.macd_hist != null ? `hist ${data.indicators.macd_hist > 0 ? "+" : ""}${data.indicators.macd_hist.toFixed(2)}`
              : key === "patterns" && data.recent_patterns.length > 0 ? data.recent_patterns.join(", ")
              : "";
            return (
              <div key={key} className="flex items-center gap-2 text-[10px]">
                <span className="w-14 text-slate-500 shrink-0">{COMPONENT_LABELS[key] ?? key}</span>
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.abs(val) / 2 * 100}%`, background: barColor }} />
                </div>
                <span className="w-6 text-right font-bold shrink-0" style={{ color: barColor }}>
                  {val > 0 ? "+" : ""}{val}
                </span>
                {hint && <span className="text-slate-300 text-[9px] truncate max-w-[60px]" title={hint}>{hint}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pattern win-rate */}
      {data.pattern_stats.length > 0 && (
        <div>
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Historical Win Rate</div>
          <div className="space-y-2">
            {data.pattern_stats.map((ps) => (
              <div key={ps.pattern} className="bg-slate-50 rounded-lg px-2.5 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-slate-700">{ps.name}</span>
                  <span className="text-[9px] text-slate-400">{ps.occurrences} occurrences</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div><div className="text-[9px] text-slate-400">5d</div><WinPct pct={ps.up5d_pct} /></div>
                  <div><div className="text-[9px] text-slate-400">10d</div><WinPct pct={ps.up10d_pct} /></div>
                  <div><div className="text-[9px] text-slate-400">20d</div><WinPct pct={ps.up20d_pct} /></div>
                </div>
                <div className={`text-center text-[10px] font-semibold mt-1 ${ps.avg_move5d >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  avg {ps.avg_move5d >= 0 ? "+" : ""}{ps.avg_move5d}% in 5d
                </div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-slate-300 mt-1.5">Based on {symbol}'s own historical data · not a guarantee</div>
        </div>
      )}

      {data.pattern_stats.length === 0 && (
        <div className="text-[9px] text-slate-400 text-center py-1">No recent patterns for win-rate stats</div>
      )}
    </div>
  );
}

export default function TrendOutlook({ symbol, data, loading, sidebar = false }: Props) {
  const [open, setOpen] = useState(false);

  if (!data && !loading) return null;

  if (sidebar) {
    return (
      <div className="flex flex-col h-full">
        {loading && !data && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[10px] text-slate-400 animate-pulse">Loading outlook…</span>
          </div>
        )}
        {data && <Body symbol={symbol} data={data} />}
      </div>
    );
  }

  // Collapsible banner mode (below-chart, legacy)
  const labelColor = data ? (LABEL_COLOR[data.label] ?? "#64748b") : "#64748b";
  return (
    <div className="border-t border-slate-100">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
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
      {open && data && <div className="px-4 pb-4"><Body symbol={symbol} data={data} /></div>}
    </div>
  );
}
