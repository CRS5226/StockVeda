import { useState } from "react";
import { BarChart2 } from "lucide-react";
import MarkovAnalysis from "./MarkovAnalysis";
import MonteCarloSimulation from "./MonteCarloSimulation";
import IndexReplication from "./IndexReplication";

type AnalysisTab = "markov" | "monte_carlo" | "index_fund";

const TABS: { key: AnalysisTab; icon: string; label: string; desc: string }[] = [
  { key: "markov", icon: "🔗", label: "Markov Chain", desc: "state transitions" },
  { key: "monte_carlo", icon: "🎲", label: "Monte Carlo", desc: "GBM price paths" },
  { key: "index_fund", icon: "📊", label: "Index Fund", desc: "replication + weights" },
];

export default function Analysis() {
  const [tab, setTab] = useState<AnalysisTab>("markov");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <BarChart2 size={14} className="text-slate-400 mr-1" />
        <span className="text-xs font-semibold text-slate-500 mr-1">Analysis</span>
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

      {tab === "markov" && <MarkovAnalysis />}
      {tab === "monte_carlo" && <MonteCarloSimulation />}
      {tab === "index_fund" && <IndexReplication />}
    </div>
  );
}
