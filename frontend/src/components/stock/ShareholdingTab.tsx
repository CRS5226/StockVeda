import { RefreshCw } from "lucide-react";
import MacroLineChart from "../MacroLineChart";
import { fmt } from "../../lib/stockFormat";
import type { Holder, Shareholding } from "../../lib/api";
import NamedHolders from "./NamedHolders";
import type { Tab } from "./stockTabs";

/** Shareholding pattern over time and the top institutional holders. */
export default function ShareholdingTab({ sym, shareholding, holders, holdersView, setHoldersView, syncingTab, syncTabData }: {
  sym: string;
  shareholding: Shareholding[];
  holders: Holder[];
  holdersView: "pattern" | "holders";
  setHoldersView: (v: "pattern" | "holders") => void;
  syncingTab: Tab | null;
  syncTabData: (source: string, forTab: Tab) => void;
}) {
  return (
    <div>
      {/* Pattern / Top Holders toggle */}
      <div className="flex gap-1.5 mb-3">
        {(["pattern", "holders"] as const).map(v => (
          <button key={v} onClick={() => setHoldersView(v)}
            className={`text-xs px-2.5 py-1 rounded-md capitalize ${holdersView === v ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            {v === "pattern" ? "Pattern" : "Top Holders"}
          </button>
        ))}
      </div>

      {holdersView === "pattern" && (
        syncingTab === "shareholding" ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
            <div className="text-xs text-slate-400">Fetching shareholding from yfinance…</div>
          </div>
        ) : shareholding.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="text-xs text-slate-400 text-center">Quarterly shareholding pattern requires NSE sync.<br/>Current snapshot is in Key Metrics above.</div>
            <button onClick={() => syncTabData("shareholding", "shareholding")} disabled={syncingTab !== null}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 text-slate-600 transition-all disabled:opacity-50">
              <RefreshCw size={11} /> Sync shareholding
            </button>
          </div>
        ) : shareholding.length <= 2 ? (
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-100">
              {["Period", "Promoter", "FII / Inst.", "DII", "MF", "Retail"].map(h => (
                <th key={h} className="text-left py-1.5 px-2">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {shareholding.map((s, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-2 text-slate-500">{s.period}</td>
                  <td className="py-1.5 px-2 text-slate-700">{s.promoter_pct != null ? `${fmt(s.promoter_pct)}%` : "—"}</td>
                  <td className="py-1.5 px-2 text-slate-700">{s.fii_pct != null ? `${fmt(s.fii_pct)}%` : "—"}</td>
                  <td className="py-1.5 px-2 text-slate-700">{s.dii_pct != null ? `${fmt(s.dii_pct)}%` : "—"}</td>
                  <td className="py-1.5 px-2 text-slate-700">{s.mf_pct != null ? `${fmt(s.mf_pct)}%` : "—"}</td>
                  <td className="py-1.5 px-2 text-slate-700">{s.retail_pct != null ? `${fmt(s.retail_pct)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <MacroLineChart title="Shareholding % (quarterly)" height={160}
            series={[
              { label: "Promoter", color: "#3b82f6", data: shareholding.map((s) => ({ date: s.period, value: s.promoter_pct ?? 0 })) },
              { label: "FII/Inst", color: "#f59e0b", data: shareholding.map((s) => ({ date: s.period, value: s.fii_pct ?? 0 })) },
              { label: "DII", color: "#10b981", data: shareholding.map((s) => ({ date: s.period, value: s.dii_pct ?? 0 })) },
            ]} />
        )
      )}

      {holdersView === "pattern" && <NamedHolders sym={sym} />}

      {holdersView === "holders" && (
        holders.length === 0 ? (
          <div className="text-xs text-slate-400 py-6 text-center">No institutional holder data available.</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-100">
              {["Holder", "% Out", "Shares (Cr)", "Date"].map(h => (
                <th key={h} className="text-left py-1.5 px-2">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {holders.map((h, i) => {
                const pct = h.pctHeld ?? h["% Out"];
                return (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-1.5 px-2 text-slate-700 max-w-[160px] truncate">{h.Holder}</td>
                    <td className="py-1.5 px-2 text-slate-600">{pct != null ? `${(pct * 100).toFixed(2)}%` : "—"}</td>
                    <td className="py-1.5 px-2 text-slate-600">{h.Shares != null ? (h.Shares / 1e7).toFixed(2) : "—"}</td>
                    <td className="py-1.5 px-2 text-slate-400">{h["Date Reported"] ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
