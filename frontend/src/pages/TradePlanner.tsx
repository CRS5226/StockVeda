import { useState } from "react";
import { Calculator } from "lucide-react";
import { api, type PlannerPrefill } from "../lib/api";
import SymbolCombobox from "../components/SymbolCombobox";
import PlannerCalculatorTab from "./PlannerCalculatorTab";
import PlannerPivotLevelsTab from "./PlannerPivotLevelsTab";
import PlannerTradeLogTab from "./PlannerTradeLogTab";
import PlannerChecklistTab from "./PlannerChecklistTab";

type PlannerTab = "calculator" | "pivots" | "log" | "checklist";

const TABS: { key: PlannerTab; icon: string; label: string; desc: string }[] = [
  { key: "calculator", icon: "🧮", label: "Trade Calculator", desc: "sizing + R:R" },
  { key: "pivots", icon: "📐", label: "Pivot Levels", desc: "classic / fib / camarilla" },
  { key: "log", icon: "📒", label: "Trade Log", desc: "journal + stats" },
  { key: "checklist", icon: "✅", label: "Checklist", desc: "pre-trade gate" },
];

export default function TradePlanner() {
  const [tab, setTab] = useState<PlannerTab>("calculator");
  const [symbol, setSymbol] = useState("RELIANCE");
  const [prefill, setPrefill] = useState<PlannerPrefill | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);

  const fetchPrefill = async () => {
    if (!symbol.trim()) return;
    setPrefillLoading(true);
    setPrefillError(null);
    try {
      const res = await api.getPlannerPrefill(symbol);
      setPrefill(res);
    } catch (e) {
      setPrefillError(String(e));
    } finally {
      setPrefillLoading(false);
    }
  };

  const needsSymbol = tab === "calculator" || tab === "pivots";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <Calculator size={14} className="text-slate-400 mr-1" />
        <span className="text-xs font-semibold text-slate-500 mr-1">Trade Planner</span>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              tab === t.key
                ? "bg-blue-500 text-white border-blue-500"
                : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
            }`}>
            <span>{t.icon}</span>
            <span>{t.label}</span>
            <span className={`text-[10px] ${tab === t.key ? "text-blue-100" : "text-slate-400"}`}>{t.desc}</span>
          </button>
        ))}
      </div>

      {needsSymbol && (
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
          <div className="w-56"><SymbolCombobox value={symbol} onChange={setSymbol} /></div>
          <button onClick={fetchPrefill} disabled={prefillLoading || !symbol.trim()}
            className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400">
            {prefillLoading ? "Fetching…" : `Prefill from ${symbol || "…"}`}
          </button>
          {prefillError && <span className="text-xs text-red-500">{prefillError}</span>}
          {prefill && !prefillError && (
            <span className="text-[10px] text-slate-400">
              Last close ₹{prefill.last_close.toFixed(2)}{prefill.atr_14 != null && ` · ATR14 ₹${prefill.atr_14.toFixed(2)}`}
            </span>
          )}
        </div>
      )}

      {tab === "calculator" && <PlannerCalculatorTab prefill={prefill} />}
      {tab === "pivots" && <PlannerPivotLevelsTab prefill={prefill} />}
      {tab === "log" && <PlannerTradeLogTab />}
      {tab === "checklist" && <PlannerChecklistTab />}
    </div>
  );
}
