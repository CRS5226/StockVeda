import type { CorporateAction, InsiderTrade } from "../../lib/api";

/** Dividends, splits and bonuses, and insider trades. */
export default function CorpActionsTab({ corporateActions, insiderTrades }: { corporateActions: CorporateAction[]; insiderTrades: InsiderTrade[] }) {
  return (
    <div className="flex flex-col gap-3">
      {corporateActions.length === 0
        ? <div className="text-xs text-slate-400 py-6 text-center">No data — sync corporate_actions first.</div>
        : (
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-100">
              {["Ex Date", "Type", "Value", "Ratio"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {corporateActions.slice(0, 10).map((a, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-2 text-slate-600">{a.ex_date}</td>
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      a.action_type === "DIVIDEND" ? "bg-emerald-50 text-emerald-700"
                      : a.action_type === "BONUS" ? "bg-blue-50 text-blue-700"
                      : "bg-slate-100 text-slate-600"}`}>
                      {a.action_type}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-slate-700">{a.value != null ? `₹${a.value}` : "—"}</td>
                  <td className="py-1.5 px-2 text-slate-600">{a.ratio ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {insiderTrades.length > 0 && (
        <>
          <div className="text-xs text-slate-500 font-medium mt-1">Insider Trades</div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-100">
              {["Name", "Date", "Type", "Qty"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {insiderTrades.slice(0, 10).map((t, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-2 max-w-[120px] truncate text-slate-700">{t.person_name}</td>
                  <td className="py-1.5 px-2 text-slate-500">{t.trade_date}</td>
                  <td className={`py-1.5 px-2 font-medium ${t.transaction_type === "Buy" ? "text-emerald-600" : "text-red-500"}`}>{t.transaction_type}</td>
                  <td className="py-1.5 px-2 text-slate-700">{t.quantity?.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
