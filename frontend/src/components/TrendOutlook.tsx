import { useState } from "react";
import { ChevronDown, AlertTriangle } from "lucide-react";

export interface PatternStat {
  pattern: string; label: string; name: string; direction: string;
  occurrences: number;
  up5d_pct: number; up10d_pct: number; up20d_pct: number;
  avg_move5d: number; avg_win5d: number | null; avg_loss5d: number | null;
  ctx_occurrences: number;
  ctx_up5d_pct: number | null; ctx_up10d_pct: number | null; ctx_up20d_pct: number | null;
  ctx_avg_move5d: number | null; ctx_avg_win5d: number | null; ctx_avg_loss5d: number | null;
  ctx_label: string | null;
}

export interface OutlookData {
  score: number;
  label: string;
  components: Record<string, number>;
  indicators: { rsi: number; macd_hist: number | null; sma20_diff_pct: number | null; close: number };
  recent_patterns: string[];
  pattern_stats: PatternStat[];
}

interface LastCandle {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

interface Props {
  symbol: string;
  data: OutlookData | null;
  loading?: boolean;
  sidebar?: boolean;
  lastCandle?: LastCandle | null;
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

/**
 * Derive the best holding window (5/10/20d) by highest directional win rate.
 * For bearish patterns the raw up5d_pct measures upward moves, so bearish win = 100 - up5d_pct.
 * avgWin/avgLoss are also flipped for bearish: winners are the down-moves (currently avg_loss5d).
 */
function bestWindow(ps: PatternStat): { days: number; winPct: number; avgWin: number | null; avgLoss: number | null } {
  const isBear  = ps.direction === "bearish";
  const useCtx  = ps.ctx_occurrences >= 3 && ps.ctx_up5d_pct != null;

  // Flip win rates for bearish patterns (price going down = win for bears)
  const flip = (wr: number | null) => wr == null ? null : (isBear ? 100 - wr : wr);

  const wr5  = flip(useCtx ? (ps.ctx_up5d_pct  ?? ps.up5d_pct)  : ps.up5d_pct);
  const wr10 = flip(useCtx ? (ps.ctx_up10d_pct ?? ps.up10d_pct) : ps.up10d_pct);
  const wr20 = flip(useCtx ? (ps.ctx_up20d_pct ?? ps.up20d_pct) : ps.up20d_pct);

  // For bearish: winners are the loss_moves (negative), losers are the win_moves (positive)
  const rawWin  = useCtx ? ps.ctx_avg_win5d  : ps.avg_win5d;   // avg of UP moves
  const rawLoss = useCtx ? ps.ctx_avg_loss5d : ps.avg_loss5d;  // avg of DOWN moves (negative)

  // avgWin for the setup = magnitude of the favourable move
  // avgLoss for the setup = magnitude of the adverse move
  const setupAvgWin  = isBear ? (rawLoss != null ? Math.abs(rawLoss) : null) : rawWin;
  const setupAvgLoss = isBear ? rawWin : (rawLoss != null ? Math.abs(rawLoss) : null);

  const rates = [
    { days: 5,  wr: wr5  ?? 0, avgWin: setupAvgWin,  avgLoss: setupAvgLoss },
    { days: 10, wr: wr10 ?? 0, avgWin: null, avgLoss: null },
    { days: 20, wr: wr20 ?? 0, avgWin: null, avgLoss: null },
  ];
  const best = rates.reduce((a, b) => (b.wr > a.wr ? b : a));
  if (best.days !== 5) {
    const scale = best.wr / ((wr5 || 1));
    best.avgWin  = setupAvgWin  != null ? round2(setupAvgWin  * scale) : null;
    best.avgLoss = setupAvgLoss != null ? round2(setupAvgLoss * scale) : null;
  }
  return { days: best.days, winPct: best.wr, avgWin: best.avgWin, avgLoss: best.avgLoss };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function fmtPrice(p: number) { return p >= 1000 ? p.toFixed(1) : p.toFixed(2); }

function fmtVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
  return v.toLocaleString("en-IN");
}

/** Generate invalidation conditions with real price/volume numbers from candle data */
function invalidations(
  ps: PatternStat,
  ind: OutlookData["indicators"],
  candle?: LastCandle | null,
): string[] {
  const isBullish = ps.direction !== "bearish";
  const items: string[] = [];

  // SMA20 price (back-calculate from diff%)
  const sma20Price = ind.sma20_diff_pct != null
    ? ind.close / (1 + ind.sma20_diff_pct / 100)
    : null;

  if (isBullish) {
    // 1. Price-level invalidation with exact number
    if (candle)
      items.push(`Close below ₹${fmtPrice(candle.low)} — pattern candle's low (${ps.name} invalidated)`);

    // 2. Volume confirmation with actual number
    if (candle)
      items.push(`Next-day volume below ${fmtVol(candle.volume)} — today's volume (weak follow-through)`);

    // 3. RSI-based with number
    if (ind.rsi > 68)
      items.push(`RSI already at ${ind.rsi} — elevated, limited upside room before hitting 70+`);
    else if (ind.rsi > 58)
      items.push(`RSI at ${ind.rsi} — if it fails to cross above 65, momentum stalling`);
    else
      items.push(`RSI at ${ind.rsi} — if it fails to rise next session, trend not confirming`);

    // 4. SMA20 reference
    if (sma20Price != null && ind.sma20_diff_pct != null) {
      if (ind.sma20_diff_pct > 6)
        items.push(`Already ${ind.sma20_diff_pct}% above SMA20 (≈₹${fmtPrice(sma20Price)}) — stretched, wait for retest`);
      else
        items.push(`SMA20 support at ≈₹${fmtPrice(sma20Price)} — close below it would cancel the setup`);
    }
  } else {
    // Bearish invalidations
    if (candle)
      items.push(`Close above ₹${fmtPrice(candle.high)} — pattern candle's high (${ps.name} invalidated)`);

    if (candle)
      items.push(`Next-day volume below ${fmtVol(candle.volume)} — weak selling pressure follow-through`);

    if (ind.rsi < 32)
      items.push(`RSI at ${ind.rsi} — already oversold, short-covering bounce likely`);
    else if (ind.rsi < 42)
      items.push(`RSI at ${ind.rsi} — approaching oversold; if it bounces above 45, exit`);
    else
      items.push(`RSI at ${ind.rsi} — if it rises next session instead of falling, bears losing control`);

    if (sma20Price != null && ind.sma20_diff_pct != null) {
      if (ind.sma20_diff_pct < -6)
        items.push(`Already ${Math.abs(ind.sma20_diff_pct)}% below SMA20 (≈₹${fmtPrice(sma20Price)}) — extended, mean-reversion risk`);
      else
        items.push(`SMA20 resistance at ≈₹${fmtPrice(sma20Price)} — close above it would cancel the short`);
    }
  }

  return items.slice(0, 4);
}

function TradeSetup({ ps, ind, candle }: { ps: PatternStat; ind: OutlookData["indicators"]; candle?: LastCandle | null }) {
  const useCtx = ps.ctx_occurrences >= 3 && ps.ctx_up5d_pct != null;
  const bw = bestWindow(ps);
  const entry = ind.close;
  const isBullish = ps.direction !== "bearish";

  // Target: avg win % at best window; fallback to avg_move5d * 1.4
  const targetPct = bw.avgWin
    ?? (ps.avg_win5d != null ? ps.avg_win5d : Math.abs(ps.avg_move5d) * 1.4);
  // SL: avg loss (already negative); fallback to half of target (2:1 R:R)
  const slPct = bw.avgLoss != null
    ? Math.abs(bw.avgLoss)
    : targetPct / 2;

  const target = isBullish ? entry * (1 + targetPct / 100) : entry * (1 - targetPct / 100);
  const sl     = isBullish ? entry * (1 - slPct     / 100) : entry * (1 + slPct     / 100);
  const rr     = slPct > 0 ? round2(targetPct / slPct) : null;

  const winPct  = useCtx ? (ps.ctx_up5d_pct ?? ps.up5d_pct) : ps.up5d_pct;
  const samples = useCtx ? ps.ctx_occurrences : ps.occurrences;

  const skips = invalidations(ps, ind, candle);

  const rrColor = rr == null ? "text-slate-500"
    : rr >= 2 ? "text-emerald-600" : rr >= 1.5 ? "text-amber-600" : "text-red-500";

  return (
    <div className="bg-slate-50 rounded-lg px-2.5 py-2.5 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-700">{ps.name}</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isBullish ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
          {isBullish ? "▲ Bullish" : "▼ Bearish"}
        </span>
      </div>

      {/* Probability + window */}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${winPct}%` }} />
        </div>
        <span className={`text-[11px] font-bold ${winPct >= 65 ? "text-emerald-600" : winPct >= 50 ? "text-amber-500" : "text-red-400"}`}>
          {winPct}%
        </span>
        <span className="text-[9px] text-slate-400">in {bw.days}d · {samples} sample{samples !== 1 ? "s" : ""}</span>
      </div>
      {useCtx && (
        <div className="text-[9px] text-blue-400">context-matched · same trend &amp; RSI zone</div>
      )}

      {/* Entry / Target / SL grid */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="bg-white rounded px-1 py-1.5">
          <div className="text-[8px] text-slate-400 mb-0.5">Entry</div>
          <div className="text-[10px] font-bold text-slate-700">₹{fmtPrice(entry)}</div>
          <div className="text-[8px] text-slate-400">current</div>
        </div>
        <div className={`rounded px-1 py-1.5 ${isBullish ? "bg-emerald-50" : "bg-red-50"}`}>
          <div className="text-[8px] text-slate-400 mb-0.5">Target</div>
          <div className={`text-[10px] font-bold ${isBullish ? "text-emerald-700" : "text-red-600"}`}>₹{fmtPrice(target)}</div>
          <div className={`text-[8px] ${isBullish ? "text-emerald-500" : "text-red-400"}`}>
            {isBullish ? "+" : "–"}{targetPct.toFixed(1)}% · ~{bw.days}d
          </div>
        </div>
        <div className="bg-red-50 rounded px-1 py-1.5">
          <div className="text-[8px] text-slate-400 mb-0.5">Stop Loss</div>
          <div className="text-[10px] font-bold text-red-600">₹{fmtPrice(sl)}</div>
          <div className="text-[8px] text-red-400">–{slPct.toFixed(1)}%{rr ? <> · <span className={rrColor}>R:R {rr}</span></> : ""}</div>
        </div>
      </div>

      {/* Invalidation conditions */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <AlertTriangle size={9} className="text-amber-500" />
          <span className="text-[8px] font-bold text-amber-600 uppercase tracking-wide">Skip / exit this trade if</span>
        </div>
        <ul className="space-y-0.5">
          {skips.map((s, i) => (
            <li key={i} className="text-[9px] text-slate-500 flex gap-1">
              <span className="text-amber-400 shrink-0">•</span>{s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Body({ symbol, data, candle }: { symbol: string; data: OutlookData; candle?: LastCandle | null }) {
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

      {/* Trade setup cards — only for patterns that actually formed recently */}
      {(() => {
        const recentCodes = new Set(data.recent_patterns);
        const activeStats = data.pattern_stats.filter(ps => recentCodes.has(ps.pattern));
        return activeStats.length > 0 ? (
          <div>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Trade Setup</div>
            <div className="space-y-2">
              {activeStats.map((ps) => (
                <TradeSetup key={ps.pattern} ps={ps} ind={data.indicators} candle={candle} />
              ))}
            </div>
            <div className="text-[9px] text-slate-300 mt-1.5">
              Based on {symbol}'s own price history · not a guarantee · always use a stop loss
            </div>
          </div>
        ) : (
          <div className="text-[9px] text-slate-400 text-center py-1">No recent patterns for trade setup</div>
        );
      })()}
    </div>
  );
}

export default function TrendOutlook({ symbol, data, loading, sidebar = false, lastCandle }: Props) {
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
        {data && <Body symbol={symbol} data={data} candle={lastCandle} />}
      </div>
    );
  }

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
      {open && data && <div className="px-4 pb-4"><Body symbol={symbol} data={data} candle={lastCandle} /></div>}
    </div>
  );
}
