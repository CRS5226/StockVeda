import { useCallback, useEffect, useState } from "react";
import { Zap, Play, AlertCircle } from "lucide-react";
import { api } from "../lib/api";
import IntradayFetchPanel from "../components/IntradayFetchPanel";

type ORBResult = Awaited<ReturnType<typeof api.runOrbBacktest>>;
const INTERVALS = ["1m", "5m", "15m", "30m", "60m"] as const;
const DIRECTIONS = ["long_only", "short_only", "both"] as const;

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function OrbBacktest() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>("5m");
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [orMinutes, setOrMinutes] = useState(15);
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>("long_only");
  const [targetPct, setTargetPct] = useState(1.0);
  const [slPct, setSlPct] = useState(0.5);
  const [forceExitTime, setForceExitTime] = useState("15:20");
  const [capitalPerTrade, setCapitalPerTrade] = useState(50000);

  const [dataStatus, setDataStatus] = useState<{ earliest_datetime: string | null; latest_datetime: string | null; total_bars: number } | null>(null);
  const [showFetchPanel, setShowFetchPanel] = useState(false);

  const [result, setResult] = useState<ORBResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDataStatus = useCallback(() => {
    if (!symbol) return;
    api.intradayDataStatus(symbol, interval).then(setDataStatus).catch(() => setDataStatus(null));
  }, [symbol, interval]);

  useEffect(() => { loadDataStatus(); }, [loadDataStatus]);

  const run = async () => {
    if (!symbol) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.runOrbBacktest({
        symbol, from_date: fromDate, to_date: toDate,
        or_minutes: orMinutes, direction, target_pct: targetPct, sl_pct: slPct,
        force_exit_time: forceExitTime, capital_per_trade: capitalPerTrade, interval,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Zap size={20} className="text-blue-600" />
        <h1 className="text-lg font-bold text-slate-800">Opening Range Breakout</h1>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Phase 10</span>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="RELIANCE, NIFTY…"
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400 font-semibold" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Interval</label>
            <select value={interval} onChange={(e) => setInterval_(e.target.value as typeof interval)}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
              {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">From Date</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">To Date</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Length of the opening-range window in minutes">OR Minutes</label>
            <input type="number" value={orMinutes} onChange={(e) => setOrMinutes(parseInt(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d.replace("_", " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Target %</label>
            <input type="number" step="0.1" value={targetPct} onChange={(e) => setTargetPct(parseFloat(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Stop Loss %</label>
            <input type="number" step="0.1" value={slPct} onChange={(e) => setSlPct(parseFloat(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Force-flatten time (HH:MM) — no overnight holds">Force Exit</label>
            <input value={forceExitTime} onChange={(e) => setForceExitTime(e.target.value)}
              placeholder="15:20"
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Capital / Trade (₹)</label>
            <input type="number" value={capitalPerTrade} onChange={(e) => setCapitalPerTrade(parseFloat(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        {/* Intraday data coverage for this symbol/interval */}
        {symbol && (
          <div className="mb-3 flex items-center gap-2 flex-wrap text-xs">
            {dataStatus?.earliest_datetime ? (
              <span className="text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                Intraday data available: <span className="font-semibold text-slate-700">{dataStatus.earliest_datetime} → {dataStatus.latest_datetime}</span> ({dataStatus.total_bars} bars)
              </span>
            ) : (
              <span className="text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">No intraday data synced yet for {symbol} ({interval})</span>
            )}
            <button onClick={() => setShowFetchPanel((s) => !s)}
              className="text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2">
              {showFetchPanel ? "Hide fetch panel" : "Fetch / extend this range"}
            </button>
          </div>
        )}

        {showFetchPanel && symbol && (
          <div className="mb-3">
            <IntradayFetchPanel symbol={symbol} interval={interval} onDone={() => { setShowFetchPanel(false); loadDataStatus(); }} />
          </div>
        )}

        <button onClick={run} disabled={!symbol || loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Running…</>
            : <><Play size={13} /> Run ORB Backtest</>}
        </button>

        <div className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          Opening Range Breakout requires intraday data fetched on-demand via Yahoo Finance — lookback is
          limited (~7 days for 1-minute bars, ~60 days for 5/15/30-minute bars). This is a standalone intraday
          backtester, separate from the daily-bar condition-based Backtest engine.
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total Trades</div>
                <div className="text-lg font-bold text-slate-800">{result.stats.total_trades}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Win Rate</div>
                <div className="text-lg font-bold text-slate-800">{result.stats.win_rate_pct.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total P&L</div>
                <div className={`text-lg font-bold ${result.stats.total_pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {fmtInr(result.stats.total_pnl)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Avg P&L %</div>
                <div className={`text-lg font-bold ${result.stats.avg_pnl_pct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {result.stats.avg_pnl_pct.toFixed(2)}%
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">Trades</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-slate-100">
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Dir</th>
                    <th className="py-1.5 pr-3 text-right">OR High</th>
                    <th className="py-1.5 pr-3 text-right">OR Low</th>
                    <th className="py-1.5 pr-3">Entry</th>
                    <th className="py-1.5 pr-3 text-right">Entry ₹</th>
                    <th className="py-1.5 pr-3">Exit</th>
                    <th className="py-1.5 pr-3 text-right">Exit ₹</th>
                    <th className="py-1.5 pr-3 text-right">P&L %</th>
                    <th className="py-1.5 pr-3 text-right">P&L ₹</th>
                    <th className="py-1.5 pr-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 font-semibold text-slate-700">{t.trade_date}</td>
                      <td className="py-1.5 pr-3 capitalize">{t.direction}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{t.or_high}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{t.or_low}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{t.entry_time.slice(11, 16)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.entry_price}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{t.exit_time.slice(11, 16)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.exit_price}</td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${t.pnl_pct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{t.pnl_pct.toFixed(2)}%</td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${t.pnl_amount >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtInr(t.pnl_amount)}</td>
                      <td className="py-1.5 pr-3 text-slate-400">{t.exit_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
