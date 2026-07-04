import { useEffect, useState } from "react";
import { Layers, Play, AlertCircle, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import MacroLineChart from "../components/MacroLineChart";

type WeightsResult = Awaited<ReturnType<typeof api.getIndexWeights>>;
type ReplicateResult = Awaited<ReturnType<typeof api.replicateIndex>>;

function fmtCr(cr: number | null) {
  if (cr == null) return "—";
  return `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}
function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function IndexReplication() {
  const [indices, setIndices] = useState<string[]>(["NIFTY 50"]);
  const [indexName, setIndexName] = useState("NIFTY 50");
  const [capital, setCapital] = useState(1_000_000);

  const [weights, setWeights] = useState<WeightsResult | null>(null);
  const [weightsLoading, setWeightsLoading] = useState(false);
  const [weightsError, setWeightsError] = useState<string | null>(null);

  const [result, setResult] = useState<ReplicateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getIndexFundIndices().then((r) => r.indices.length && setIndices(r.indices)).catch(() => {});
  }, []);

  useEffect(() => {
    setWeights(null); setWeightsError(null); setWeightsLoading(true);
    api.getIndexWeights(indexName)
      .then(setWeights)
      .catch((e) => setWeightsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setWeightsLoading(false));
  }, [indexName]);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.replicateIndex({ index_name: indexName, capital });
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
        <Layers size={20} className="text-blue-600" />
        <h1 className="text-lg font-bold text-slate-800">Index Fund Replication</h1>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Phase 6b</span>
      </div>

      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 leading-relaxed">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div>
          niftyindices.com (the official source for constituent weights) is unreachable from this server, so
          weights below are a <strong>computed proxy</strong> — free-float market cap (latest close × shares
          outstanding × free-float factor from shareholding data) — not the official NSE numbers.
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Index</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
              {indices.map((idx) => (
                <button key={idx} onClick={() => setIndexName(idx)}
                  className={`flex-1 font-medium transition-colors px-1 ${indexName === idx ? "bg-blue-500 text-white" : "text-slate-500 bg-slate-50 hover:bg-slate-100"}`}>
                  {idx}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Capital to Deploy</label>
            <input type="number" value={capital} onChange={(e) => setCapital(parseFloat(e.target.value) || 0)}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Building portfolio…</>
            : <><Play size={13} /> Build Replicating Portfolio</>}
        </button>
      </section>

      {weightsError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" /> {weightsError}
        </div>
      )}

      {!result && weights && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{weights.index_name} — Computed Constituent Weights</div>
          <div className="text-[10px] text-slate-400 mb-3">
            {weights.constituents.length} constituents · sums to {weights.total_weight_pct}%
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-slate-400 text-left border-b border-slate-100">
                  <th className="py-1.5 pr-3">Symbol</th>
                  <th className="py-1.5 pr-3 text-right">Weight %</th>
                  <th className="py-1.5 pr-3 text-right">Market Cap</th>
                </tr>
              </thead>
              <tbody>
                {weights.constituents.map((c) => (
                  <tr key={c.symbol} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 font-semibold text-slate-700">{c.symbol}</td>
                    <td className="py-1.5 pr-3 text-right">{c.weight_pct.toFixed(2)}%</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{fmtCr(c.market_cap_cr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {weightsLoading && !weights && (
        <div className="text-xs text-slate-400 px-1">Computing proxy weights (fetching shares outstanding per constituent)…</div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {result && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Capital</div>
                <div className="text-lg font-bold text-slate-800">{fmtInr(result.capital)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Allocated</div>
                <div className="text-lg font-bold text-slate-800">{fmtInr(result.total_allocated)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Cash Remaining</div>
                <div className="text-lg font-bold text-slate-800">{fmtInr(result.cash_remaining)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Tracking Error (ann.)</div>
                <div className="text-lg font-bold text-slate-800">
                  {result.tracking_error.tracking_error_annualized_pct != null ? `${result.tracking_error.tracking_error_annualized_pct.toFixed(2)}%` : "—"}
                </div>
              </div>
            </div>
            {result.tracking_error.correlation != null && (
              <div className="text-[10px] text-slate-400 mt-2">
                Correlation vs index: {result.tracking_error.correlation.toFixed(3)} · Cumulative drift: {result.tracking_error.cumulative_drift_pct?.toFixed(2)}%
              </div>
            )}
            {result.value_path_coverage?.note && (
              <div className="flex items-start gap-2 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-800 leading-relaxed">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <div>
                  {result.value_path_coverage.note} {result.value_path_coverage.excluded_symbols.length} constituent(s)
                  excluded from the chart below (insufficient history): {result.value_path_coverage.excluded_symbols.join(", ")}.
                </div>
              </div>
            )}
          </section>

          {result.value_path.length > 1 && (
            <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">Replicating Portfolio Value</div>
              <MacroLineChart
                height={220}
                series={[{ label: "Portfolio Value", color: "#34d399", data: result.value_path }]}
              />
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">Allocation</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-slate-100">
                    <th className="py-1.5 pr-3">Symbol</th>
                    <th className="py-1.5 pr-3 text-right">Weight %</th>
                    <th className="py-1.5 pr-3 text-right">Price</th>
                    <th className="py-1.5 pr-3 text-right">Shares</th>
                    <th className="py-1.5 pr-3 text-right">₹ Allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {result.constituents.map((c) => (
                    <tr key={c.symbol} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 font-semibold text-slate-700">{c.symbol}</td>
                      <td className="py-1.5 pr-3 text-right">{c.weight_pct.toFixed(2)}%</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">₹{c.price.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right">{c.shares}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{fmtInr(c.actual_allocation)}</td>
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
