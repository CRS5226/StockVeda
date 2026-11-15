import { FlaskConical } from "lucide-react";
import BacktestResults from "../BacktestResults";
import type { useBacktestStore } from "../../store/useBacktestStore";

type BacktestState = ReturnType<typeof useBacktestStore.getState>;

/** A quick one-stock backtest. No tab button opens this today; it is kept as it was. */
export default function BacktestTab({ strategies, params, setParams, applyStrategy, runBacktest, btLoading, btError, btResults }: {
  strategies: BacktestState["strategies"];
  params: BacktestState["params"];
  setParams: BacktestState["setParams"];
  applyStrategy: BacktestState["applyStrategy"];
  runBacktest: BacktestState["runBacktest"];
  btLoading: boolean;
  btError: string | null;
  btResults: BacktestState["results"];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <select value={strategies.findIndex((s) => s.params.entry_col === params.entry_col && s.params.entry_threshold_col === params.entry_threshold_col)}
          onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) applyStrategy(s); }}
          className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none">
          <option value="-1">Custom</option>
          {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
        </select>
        <input type="date" value={params.from_date} onChange={(e) => setParams({ from_date: e.target.value })}
          className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
        <input type="date" value={params.to_date} onChange={(e) => setParams({ to_date: e.target.value })}
          className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
        <input type="number" value={params.initial_capital} onChange={(e) => setParams({ initial_capital: Number(e.target.value) })}
          placeholder="Capital ₹" className="w-28 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
        <button onClick={runBacktest} disabled={btLoading}
          className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors">
          <FlaskConical size={12} />{btLoading ? "Running…" : "Run"}
        </button>
      </div>
      {btError && <div className="text-red-500 text-xs">{btError}</div>}
      {btResults && <BacktestResults results={btResults} />}
    </div>
  );
}
