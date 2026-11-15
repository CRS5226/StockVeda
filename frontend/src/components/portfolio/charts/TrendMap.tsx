import type { SignalRow } from "../../../lib/api";

const X_MIN = -50, X_MAX = 80, Y_MIN = -70, Y_MAX = 0;      // percent against the 200-day average, percent from the 52-week high
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const LEAN = { bullish: "#10b981", neutral: "#94a3b8", bearish: "#ef4444" } as const;

/** One dot per stock: right is above its 200-day average, up is near its 52-week high. Colour is the daily lean, size the weight. */
export default function TrendMap({ rows }: { rows: SignalRow[] }) {
  const w = 300, h = 190, padL = 26, padB = 18, padT = 6, padR = 6;
  const x = (v: number) => padL + ((clamp(v, X_MIN, X_MAX) - X_MIN) / (X_MAX - X_MIN)) * (w - padL - padR);
  const y = (v: number) => padT + ((Y_MAX - clamp(v, Y_MIN, Y_MAX)) / (Y_MAX - Y_MIN)) * (h - padT - padB);
  const dots = rows.filter((r) => r.trend.sma200 && r.trend.last !== null && r.trend.from_high_pct !== null);
  const widest = Math.max(...dots.map((r) => r.weight_pct), 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Trend map of the stocks">
        <rect x={x(0)} y={padT} width={x(X_MAX) - x(0)} height={y(-25) - padT} fill="#ecfdf5" />
        <rect x={padL} y={y(-25)} width={x(0) - padL} height={y(Y_MIN) - y(-25)} fill="#fef2f2" />
        <line x1={x(0)} x2={x(0)} y1={padT} y2={h - padB} stroke="#94a3b8" strokeDasharray="3 3" />
        <line x1={padL} x2={w - padR} y1={y(-25)} y2={y(-25)} stroke="#94a3b8" strokeDasharray="3 3" />
        {dots.map((r) => (
          <circle key={r.symbol} cx={x((r.trend.last! / r.trend.sma200! - 1) * 100)} cy={y(r.trend.from_high_pct!)} r={2.5 + (r.weight_pct / widest) * 4}
            fill={LEAN[r.timeframes["1D"]?.lean ?? "neutral"]} fillOpacity={0.75} stroke="white" strokeWidth={0.5}>
            <title>{`${r.symbol}: ${((r.trend.last! / r.trend.sma200! - 1) * 100).toFixed(0)}% vs 200-day, ${r.trend.from_high_pct!.toFixed(0)}% from high`}</title>
          </circle>
        ))}
        <text x={w - padR} y={h - 4} fontSize="8" fill="#64748b" textAnchor="end">vs 200-day average →</text>
        <text x={6} y={padT + 8} fontSize="8" fill="#64748b">near high</text>
        <text x={6} y={h - padB - 3} fontSize="8" fill="#64748b">far</text>
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
        {(["bullish", "neutral", "bearish"] as const).map((k) => <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: LEAN[k] }} />{k === "bullish" ? "Bull" : k === "bearish" ? "Bear" : "Neutral"}</span>)}
        <span className="ml-auto">dot size = weight</span>
      </div>
    </div>
  );
}
