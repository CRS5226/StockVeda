import { useState } from "react";
import { GitBranch, Play, AlertCircle } from "lucide-react";
import { api } from "../lib/api";

type MarkovResult = Awaited<ReturnType<typeof api.getMarkovAnalysis>>;

function stateLabel(state: number, nStates: number): string {
  if (nStates === 3) return ["Down", "Flat", "Up"][state] ?? String(state);
  if (state === 0) return "Most Bearish";
  if (state === nStates - 1) return "Most Bullish";
  return `State ${state}`;
}

// Red (bearish) -> slate (neutral) -> green (bullish), interpolated by relative state position.
function stateColor(state: number, nStates: number): string {
  const t = nStates === 1 ? 0.5 : state / (nStates - 1); // 0..1
  if (t < 0.5) {
    const k = t / 0.5; // 0 (red) -> 1 (slate)
    return `rgb(${Math.round(239 - k * (239 - 148))}, ${Math.round(68 + k * (163 - 68))}, ${Math.round(68 + k * (184 - 68))})`;
  }
  const k = (t - 0.5) / 0.5; // 0 (slate) -> 1 (green)
  return `rgb(${Math.round(148 - k * (148 - 16))}, ${Math.round(163 + k * (185 - 163))}, ${Math.round(184 - k * (184 - 129))})`;
}

function heatColor(p: number): string {
  // Blue heat scale, independent of state identity colors above — this scale is purely "how likely".
  const alpha = 0.1 + p * 0.75;
  return `rgba(59, 130, 246, ${alpha})`;
}

export default function MarkovAnalysis() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [nStates, setNStates] = useState(3);
  const [flatBandPct, setFlatBandPct] = useState(0.5);
  const [lookbackDays, setLookbackDays] = useState(252);
  const [horizonDays, setHorizonDays] = useState(5);
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));

  const [result, setResult] = useState<MarkovResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!symbol) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.getMarkovAnalysis(symbol, {
        from_date: fromDate, to_date: toDate, n_states: nStates,
        flat_band_pct: flatBandPct, lookback_days: lookbackDays, horizon_days: horizonDays,
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
        <GitBranch size={20} className="text-blue-600" />
        <h1 className="text-lg font-bold text-slate-800">Markov Chain Analysis</h1>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Phase 5</span>
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
            <label className="text-xs text-slate-500 mb-1 block" title="Rolling window used to estimate the transition matrix">Lookback Days</label>
            <input type="number" value={lookbackDays} onChange={(e) => setLookbackDays(parseInt(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="3 = up/flat/down (recommended). More states = finer detail but noisier estimates.">Number of States</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
              {[3, 5, 7].map((n) => (
                <button key={n} onClick={() => setNStates(n)}
                  className={`flex-1 font-medium transition-colors ${nStates === n ? "bg-blue-500 text-white" : "text-slate-500 bg-slate-50 hover:bg-slate-100"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="|daily return| below this % counts as 'flat' (3-state mode only)">Flat Band %</label>
            <input type="number" step="0.1" value={flatBandPct} onChange={(e) => setFlatBandPct(parseFloat(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Horizon (days ahead)</label>
            <input type="number" value={horizonDays} onChange={(e) => setHorizonDays(parseInt(e.target.value))}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <button onClick={run} disabled={!symbol || loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Analyzing…</>
            : <><Play size={13} /> Run Analysis</>}
        </button>

        <div className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          Statistical model over historical daily returns — not a prediction guarantee. States are discretized returns
          (fixed thresholds, not fitted from future data), and the transition matrix is estimated from the trailing
          lookback window only. These same signals (markov_p_up / markov_p_down / markov_confidence) are also available
          as ordinary conditions in the Backtest page's condition builder.
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
          {/* Current state */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">Current State — {result.symbol}</div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: stateColor(result.current_state, result.n_states) }} />
              <span className="text-xl font-bold text-slate-800">{stateLabel(result.current_state, result.n_states)}</span>
              <span className="text-xs text-slate-400 ml-2">estimated from the trailing {result.lookback_days_used} trading days</span>
            </div>
          </section>

          {/* Transition matrix heatmap */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-1">Transition Matrix</div>
            <div className="text-[10px] text-slate-400 mb-3">P(column state tomorrow | row state today) — rows sum to 100%</div>
            <div className="overflow-x-auto">
              <table className="border-collapse">
                <thead>
                  <tr>
                    <th className="text-[10px] text-slate-400 px-2 py-1 text-left">From \ To</th>
                    {result.transition_matrix.map((_, j) => (
                      <th key={j} className="text-[10px] px-3 py-1 text-center font-semibold" style={{ color: stateColor(j, result.n_states) }}>
                        {stateLabel(j, result.n_states)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.transition_matrix.map((row, i) => (
                    <tr key={i}>
                      <td className="text-[10px] px-2 py-1 font-semibold whitespace-nowrap" style={{ color: stateColor(i, result.n_states) }}>
                        {stateLabel(i, result.n_states)}
                      </td>
                      {row.map((p, j) => (
                        <td key={j} className="text-xs text-center px-3 py-2 border border-slate-100 font-medium"
                          style={{ backgroundColor: heatColor(p) }}>
                          {(p * 100).toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Forward projection */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">Forward Projection</div>
            <div className="space-y-2">
              {result.projection.map((row) => (
                <div key={row.step} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-slate-500 shrink-0">Day +{row.step}</span>
                  <div className="flex-1 flex h-5 rounded-md overflow-hidden border border-slate-100">
                    {Array.from({ length: result.n_states }, (_, s) => row[`state_${s}`] ?? 0).map((p, s) => (
                      <div key={s} title={`${stateLabel(s, result.n_states)}: ${(p * 100).toFixed(1)}%`}
                        style={{ width: `${p * 100}%`, background: stateColor(s, result.n_states) }} />
                    ))}
                  </div>
                  <span className="w-24 text-right text-slate-400 shrink-0">
                    {(Math.max(...Array.from({ length: result.n_states }, (_, s) => row[`state_${s}`] ?? 0)) * 100).toFixed(0)}% conf.
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Historical state timeline */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-1">Historical State Timeline</div>
            <div className="text-[10px] text-slate-400 mb-3">{result.history.length} trading days · hover a bar for its date</div>
            <div className="flex items-end gap-px h-16 overflow-x-auto">
              {result.history.map((h, i) => (
                <div key={i} title={`${h.date}: ${stateLabel(h.state, result.n_states)}`}
                  className="w-1.5 h-full shrink-0 rounded-sm"
                  style={{ background: stateColor(h.state, result.n_states) }} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
