import { useEffect } from "react";
import { useScreenerStore } from "../store/useScreenerStore";

const OP_LABELS: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤", eq: "=" };

export default function ScreenerFilters() {
  const { conditions, presets, metrics, operators, loading,
    addCondition, updateCondition, removeCondition, setConditions,
    runScreen, loadPresets, loadMetrics } = useScreenerStore();

  useEffect(() => { loadPresets(); loadMetrics(); }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Presets */}
      <div>
        <div className="text-xs text-gray-500 font-medium mb-2">Presets</div>
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <button key={p.name} onClick={() => setConditions(p.conditions)}
              className="text-left text-xs px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Conditions */}
      <div>
        <div className="text-xs text-gray-500 font-medium mb-2">Conditions</div>
        <div className="flex flex-col gap-2">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <select value={c.metric}
                onChange={(e) => updateCondition(i, { ...c, metric: e.target.value })}
                className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 outline-none">
                {metrics.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={c.op}
                onChange={(e) => updateCondition(i, { ...c, op: e.target.value })}
                className="w-12 bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 outline-none">
                {operators.map((o) => <option key={o} value={o}>{OP_LABELS[o] ?? o}</option>)}
              </select>
              <input type="number" value={c.value}
                onChange={(e) => updateCondition(i, { ...c, value: Number(e.target.value) })}
                className="w-16 bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 outline-none" />
              <button onClick={() => removeCondition(i)}
                className="text-gray-600 hover:text-red-400 text-xs px-1">✕</button>
            </div>
          ))}
        </div>
        <button
          onClick={() => addCondition({ metric: metrics[0] ?? "close", op: "gt", value: 0 })}
          className="mt-2 text-xs text-blue-400 hover:text-blue-300">
          + Add condition
        </button>
      </div>

      <button
        onClick={runScreen}
        disabled={loading || conditions.length === 0}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded px-3 py-2">
        {loading ? "Screening…" : "Run Screen"}
      </button>
    </div>
  );
}
