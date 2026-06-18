import { useState, useEffect, useRef } from "react";
import { useBacktestStore } from "../store/useBacktestStore";
import { api } from "../lib/api";
import BacktestResults from "../components/BacktestResults";

interface SearchResult { symbol: string; name?: string }

export default function Backtest() {
  const { params, results, loading, error, strategies, setParams, applyStrategy, runBacktest, loadStrategies } = useBacktestStore();
  const [query, setQuery] = useState(params.symbol ?? "");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [results2, setResults2] = useState<typeof results>(null);
  const [loading2, setLoading2] = useState(false);
  const [params2, setParams2] = useState({ ...params, symbol: "" });
  const [query2, setQuery2] = useState("");
  const [suggestions2, setSuggestions2] = useState<SearchResult[]>([]);
  const [showDrop2, setShowDrop2] = useState(false);
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadStrategies(); }, []);

  const search = (q: string, set: (r: SearchResult[]) => void) => {
    if (!q.trim()) { set([]); return; }
    api.searchSymbols(q).then((syms) => set(syms.map((s) => ({ symbol: s })))).catch(() => set([]));
  };

  const handleQ1 = (v: string) => {
    setQuery(v);
    if (t1.current) clearTimeout(t1.current);
    t1.current = setTimeout(() => search(v, setSuggestions), 200);
    setShowDrop(true);
  };
  const handleQ2 = (v: string) => {
    setQuery2(v);
    if (t2.current) clearTimeout(t2.current);
    t2.current = setTimeout(() => search(v, setSuggestions2), 200);
    setShowDrop2(true);
  };

  const runCompare = async () => {
    if (!params2.symbol) return;
    setLoading2(true);
    try {
      const res = await api.runBacktest(params2 as Parameters<typeof api.runBacktest>[0]);
      setResults2(res);
    } catch { /* ignore */ }
    setLoading2(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Strategy 1 */}
        <div className="bg-gray-900 border border-gray-800 rounded p-4 flex flex-col gap-3">
          <div className="text-sm font-semibold text-gray-200">Strategy 1</div>
          <div className="relative">
            <input value={query} onChange={(e) => handleQ1(e.target.value)} onFocus={() => setShowDrop(true)}
              placeholder="Search symbol…"
              className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 outline-none" />
            {showDrop && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded mt-1 z-20 max-h-40 overflow-y-auto">
                {suggestions.map((s) => (
                  <div key={s.symbol}
                    onMouseDown={() => { setParams({ symbol: s.symbol }); setQuery(s.symbol); setShowDrop(false); }}
                    className="px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 cursor-pointer">
                    <span className="font-medium text-blue-400">{s.symbol}</span>
                    <span className="ml-2 text-gray-400">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <select value={strategies.findIndex((s) => s.params.entry_col === params.entry_col)}
            onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) applyStrategy(s); }}
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none">
            <option value="-1">Custom</option>
            {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="date" value={params.from_date} onChange={(e) => setParams({ from_date: e.target.value })}
              className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
            <input type="date" value={params.to_date} onChange={(e) => setParams({ to_date: e.target.value })}
              className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          </div>
          <input type="number" value={params.initial_capital}
            onChange={(e) => setParams({ initial_capital: Number(e.target.value) })}
            placeholder="Capital ₹"
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          <button onClick={runBacktest} disabled={loading || !params.symbol}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded px-3 py-2">
            {loading ? "Running…" : "Run Backtest"}
          </button>
          {error && <div className="text-red-400 text-xs">{error}</div>}
          {results && <BacktestResults results={results} />}
        </div>

        {/* Strategy 2 (compare) */}
        <div className="bg-gray-900 border border-gray-800 rounded p-4 flex flex-col gap-3">
          <div className="text-sm font-semibold text-gray-200">Strategy 2 <span className="text-gray-600 text-xs font-normal">(compare)</span></div>
          <div className="relative">
            <input value={query2} onChange={(e) => handleQ2(e.target.value)} onFocus={() => setShowDrop2(true)}
              placeholder="Search symbol…"
              className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 outline-none" />
            {showDrop2 && suggestions2.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded mt-1 z-20 max-h-40 overflow-y-auto">
                {suggestions2.map((s) => (
                  <div key={s.symbol}
                    onMouseDown={() => { setParams2((p) => ({ ...p, symbol: s.symbol })); setQuery2(s.symbol); setShowDrop2(false); }}
                    className="px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 cursor-pointer">
                    <span className="font-medium text-blue-400">{s.symbol}</span>
                    <span className="ml-2 text-gray-400">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <select value={strategies.findIndex((s) => s.params.entry_col === params2.entry_col)}
            onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) setParams2((p) => ({ ...p, ...s.params })); }}
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none">
            <option value="-1">Custom</option>
            {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="date" value={params2.from_date} onChange={(e) => setParams2((p) => ({ ...p, from_date: e.target.value }))}
              className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
            <input type="date" value={params2.to_date} onChange={(e) => setParams2((p) => ({ ...p, to_date: e.target.value }))}
              className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          </div>
          <input type="number" value={params2.initial_capital}
            onChange={(e) => setParams2((p) => ({ ...p, initial_capital: Number(e.target.value) }))}
            placeholder="Capital ₹"
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          <button onClick={runCompare} disabled={loading2 || !params2.symbol}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded px-3 py-2">
            {loading2 ? "Running…" : "Run Backtest"}
          </button>
          {results2 && <BacktestResults results={results2} />}
        </div>
      </div>
    </div>
  );
}
