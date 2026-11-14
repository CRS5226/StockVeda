import { usePortfolioSignals } from "../../lib/usePortfolioSignals";
import SignalsSettings from "./signals/SignalsSettings";
import SignalsTable from "./signals/SignalsTable";
import StatCards from "./StatCards";

/**
 * Standard indicator rules (EMA, MACD, RSI, Bollinger, breakouts) on weekly, daily and 1-hour candles for each stock,
 * with the user's own thresholds turned into zones. Educational maths on prices: rule states, not advice.
 */
export default function SignalsSection({ portfolioId, refreshKey }: { portfolioId: number; refreshKey: number }) {
  const signals = usePortfolioSignals(portfolioId, refreshKey);
  const r = signals.report;
  if (signals.error && !r) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{signals.error}</div>;
  if (!r) return <div className="py-10 text-center text-sm text-slate-400">Working out the rules…</div>;
  const s = r.summary;
  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        For education only. These are what standard indicator rules say about past prices, and zones built from thresholds you set. They are not advice or suggestions to buy, sell or hold anything, and rules like these often fail after costs; check any idea yourself.
      </div>
      <StatCards items={[
        { label: "Stocks with rules", value: `${s.with_signals} of ${s.stocks}`, hint: "Needs enough stored candles" },
        { label: "Bullish on all timeframes", value: String(s.aligned_bullish), tone: s.aligned_bullish > 0 ? "text-emerald-600" : undefined },
        { label: "Bearish on all timeframes", value: String(s.aligned_bearish), tone: s.aligned_bearish > 0 ? "text-red-600" : undefined },
        { label: "In profit-booking zone", value: String(s.profit_zone), tone: s.profit_zone > 0 ? "text-amber-600" : undefined },
        { label: "In recovery zone", value: String(s.recovery_zone), tone: s.recovery_zone > 0 ? "text-blue-600" : undefined },
      ]} />
      {signals.error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{signals.error}</div>}
      <SignalsSettings key={JSON.stringify(r.settings)} settings={r.settings} onSave={signals.saveSettings} />
      <SignalsTable rows={r.rows} maxPct={r.max_position_pct} />
      <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">
        How to read it: <b>EMA 20/50</b>, <b>price vs 200 average</b>, <b>MACD</b> and <b>20-candle breakout</b> follow the trend; <b>RSI</b> and <b>Bollinger bands</b> look for stretched prices. ADX decides which group counts: trend rules when the market is trending, stretch rules when it is ranging.
      </div>
    </div>
  );
}
