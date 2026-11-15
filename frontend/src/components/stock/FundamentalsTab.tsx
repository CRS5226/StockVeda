import { fmt, fmtCr } from "../../lib/stockFormat";
import type { Fundamental } from "../../lib/api";
import type { FundView } from "./stockTabs";

/** Profit and loss, balance sheet and cash flow for the last periods. */
export default function FundamentalsTab({ fundamentals, fundPeriod, fundView, loadingFundamentals, onFundView, onFundPeriod }: {
  fundamentals: Fundamental[];
  fundPeriod: "Q" | "A";
  fundView: FundView;
  loadingFundamentals: boolean;
  onFundView: (v: FundView) => void;
  onFundPeriod: (p: "Q" | "A") => void;
}) {
  const annual = fundamentals.filter(f => f.period_type === "A");
  const quarterly = fundamentals.filter(f => f.period_type === "Q");
  const data = fundPeriod === "Q" ? quarterly : annual;
  const cols = data.slice(0, 5);

  const PL_ROWS: [string, string, (v: number | null | undefined) => string][] = [
    ["Revenue", "revenue", fmtCr],
    ["EBITDA", "ebitda", fmtCr],
    ["PAT", "pat", fmtCr],
    ["EPS (₹)", "eps_basic", v => v != null ? `₹${fmt(v)}` : "—"],
    ["EPS Diluted", "eps_diluted", v => v != null ? `₹${fmt(v)}` : "—"],
    ["EBIT", "ebit", fmtCr],
    ["PBT", "pbt", fmtCr],
  ];
  const BS_ROWS: [string, string, (v: number | null | undefined) => string][] = [
    ["Total Assets", "total_assets", fmtCr],
    ["Total Equity", "total_equity", fmtCr],
    ["Total Debt", "total_debt", fmtCr],
    ["Cash & Equiv.", "cash", fmtCr],
    ["Gross Profit", "gross_profit", fmtCr],
  ];
  const CF_ROWS: [string, string, (v: number | null | undefined) => string][] = [
    ["Operating CF", "cfo", fmtCr],
    ["Investing CF", "cfi", fmtCr],
    ["Financing CF", "cff", fmtCr],
    ["Capex", "capex", fmtCr],
    ["Free CF", "cfo", v => {
      return "—";
    }],
  ];

  const viewRows = fundView === "pl" ? PL_ROWS : fundView === "bs" ? BS_ROWS : CF_ROWS;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1.5">
          {([["pl", "P&L"], ["bs", "Balance Sheet"], ["cf", "Cash Flow"]] as [FundView, string][]).map(([v, label]) => (
            <button key={v} onClick={() => onFundView(v)}
              className={`text-xs px-2.5 py-1 rounded-md ${fundView === v ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["Q", "A"] as const).map((p) => (
            <button key={p} onClick={() => onFundPeriod(p)}
              className={`text-xs px-2 py-1 rounded-md ${fundPeriod === p ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {p === "Q" ? "Quarterly" : "Annual"}
            </button>
          ))}
        </div>
      </div>
      {loadingFundamentals ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" /></div>
      ) : data.length === 0 ? (
        <div className="text-xs text-slate-400 py-6 text-center">No data available.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left py-1.5 px-2">Metric</th>
                {cols.map(f => <th key={f.period} className="text-right py-1.5 px-2 font-medium">{f.period.slice(0, 7)}</th>)}
              </tr></thead>
              <tbody>
                {viewRows.map(([label, key]) => {
                  const hasAnyVal = cols.some(f => f[key as keyof typeof f] != null);
                  if (!hasAnyVal) return null;
                  return (
                    <tr key={key + label} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-1.5 px-2 text-slate-500">{label}</td>
                      {cols.map(f => {
                        const v = f[key as keyof typeof f] as number | null | undefined;
                        return (
                          <td key={f.period} className={`py-1.5 px-2 text-right ${v != null && v < 0 ? "text-red-500" : "text-slate-700"}`}>
                            {fmtCr(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Free Cash Flow row for CF view */}
          {fundView === "cf" && cols.some(f => f.cfo != null && f.capex != null) && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  <tr className="bg-slate-50 rounded">
                    <td className="py-1.5 px-2 text-slate-500 font-medium">Free CF</td>
                    {cols.map(f => {
                      const fcf = f.cfo != null && f.capex != null ? f.cfo + f.capex : null;
                      return (
                        <td key={f.period} className={`py-1.5 px-2 text-right font-medium ${fcf != null && fcf < 0 ? "text-red-500" : "text-emerald-600"}`}>
                          {fmtCr(fcf)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
