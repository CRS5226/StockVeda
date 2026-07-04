import { useMemo, useState } from "react";
import { Dices, Play, AlertCircle } from "lucide-react";
import { api } from "../lib/api";
import MacroLineChart from "../components/MacroLineChart";

type MonteCarloResult = Awaited<ReturnType<typeof api.getMonteCarloAnalysis>>;
type Series = { label: string; color: string; data: { date: string; value: number }[] };

const EMPTY_SERIES: Series[] = [];

function fmt(n?: number | null, dec = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

// Forward trading-day labels from as_of_date — skips Sat/Sun, no holiday calendar
// needed for a "what could happen" scenario chart (unlike backtest P&L, which must be exact).
function forwardBusinessDates(asOfDate: string, horizonDays: number): string[] {
  const dates: string[] = [asOfDate];
  const cur = new Date(asOfDate + "T00:00:00");
  while (dates.length <= horizonDays) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day === 0 || day === 6) continue;
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}

export default function MonteCarloSimulation() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [nSimulations, setNSimulations] = useState(1000);
  const [horizonDays, setHorizonDays] = useState(30);
  const [lookbackDays, setLookbackDays] = useState(252);
  const [seed, setSeed] = useState("");
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));

  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!symbol) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.getMonteCarloAnalysis(symbol, {
        from_date: fromDate, to_date: toDate, n_simulations: nSimulations,
        horizon_days: horizonDays, lookback_days: lookbackDays,
        seed: seed.trim() === "" ? undefined : parseInt(seed, 10),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const series = useMemo<Series[]>(() => {
    if (!result) return EMPTY_SERIES;
    const dates = forwardBusinessDates(result.as_of_date, result.horizon_days);
    const zip = (values: number[], label: string, color: string): Series => ({
      label, color, data: values.map((v, i) => ({ date: dates[i], value: v })),
    });
    return [
      zip(result.percentile_paths.p95, "p95", "#cbd5e1"),
      zip(result.percentile_paths.p50, "p50 (median)", "#3b82f6"),
      zip(result.percentile_paths.p5, "p5", "#cbd5e1"),
    ];
  }, [result]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Dices size={20} className="text-blue-600" />
        <h1 className="text-lg font-bold text-slate-800">Monte Carlo Simulation</h1>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Phase 9</span>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="NIFTY, RELIANCE…"
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400 font-semibold" />
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
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Rolling window used to estimate drift and volatility">Lookback Days</label>
            <input type="number" value={lookbackDays} onChange={(e) => setLookbackDays(parseInt(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Number of Simulations</label>
            <input type="number" value={nSimulations} onChange={(e) => setNSimulations(parseInt(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Horizon (trading days ahead)</label>
            <input type="number" value={horizonDays} onChange={(e) => setHorizonDays(parseInt(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Optional — set for a reproducible run">Seed (optional)</label>
            <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <button onClick={run} disabled={!symbol || loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Simulating…</>
            : <><Play size={13} /> Run Simulation</>}
        </button>

        <div className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          Simulated forward scenario using Geometric Brownian Motion — drift and volatility estimated from this
          symbol's own trailing daily returns (not risk-free-rate-adjusted, not implied volatility). This is a
          statistical range of possible outcomes, not a prediction. p50 is the median simulated path; p5/p95 bound
          the middle 90% of simulated outcomes at each forward day.
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Last Price</div>
                <div className="text-lg font-bold text-slate-800">₹{fmt(result.last_price)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">As Of</div>
                <div className="text-lg font-bold text-slate-800">{result.as_of_date}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Drift (ann.)</div>
                <div className={`text-lg font-bold ${result.drift_annualized >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {result.drift_annualized >= 0 ? "+" : ""}{(result.drift_annualized * 100).toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Volatility (ann.)</div>
                <div className="text-lg font-bold text-slate-800">{(result.volatility_annualized * 100).toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Lookback Used</div>
                <div className="text-lg font-bold text-slate-800">{result.lookback_days_used}d</div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-1">Simulated Price Paths — {result.n_simulations.toLocaleString("en-IN")} runs</div>
            <div className="text-[10px] text-slate-400 mb-3">p50 (median, bold) with p5/p95 bounding the middle 90% of outcomes</div>
            <MacroLineChart height={260} series={series} />
          </section>
        </>
      )}
    </div>
  );
}
