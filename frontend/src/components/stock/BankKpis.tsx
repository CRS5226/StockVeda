import MetricCard from "./MetricCard";
import { fmt } from "../../lib/stockFormat";
import type { BankFinancial } from "../../lib/api";
import type { MetricsTab } from "./metricsTab";

/** Bank-only KPIs (GNPA, NPA, NII, capital), shown on the Ownership metrics tab. */
export default function BankKpis({ metricsTab, bankFinancials }: {
  metricsTab: MetricsTab;
  bankFinancials: BankFinancial[] | null;
}) {
  return (
    <>
      {/* Bank KPIs — GNPA, NPA, NII, CET1 (only on ownership tab) */}
      {metricsTab === "ownership" && bankFinancials && bankFinancials.length > 0 && (() => {
        const latest = bankFinancials[0];
        const periodLabel = latest.period
          ? new Date(latest.period).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
          : "";
        const capitalPct = latest.crar_pct ?? latest.cet1_pct;
        const capitalLabel = latest.crar_pct != null ? "CRAR %" : "CET1 %";
        return (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-400 font-medium mb-2">
              Bank KPIs — {periodLabel}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricCard label="GNPA %" value={latest.gnpa_pct != null ? `${fmt(latest.gnpa_pct)}%` : "—"}
                up={latest.gnpa_pct != null ? latest.gnpa_pct < 3 : undefined} />
              <MetricCard label="Net NPA %" value={latest.net_npa_pct != null ? `${fmt(latest.net_npa_pct)}%` : "—"}
                up={latest.net_npa_pct != null ? latest.net_npa_pct < 1 : undefined} />
              <MetricCard label="NII" value={latest.nii_cr != null ? `₹${fmt(latest.nii_cr)}Cr` : "—"}
                up={latest.nii_cr != null ? latest.nii_cr > 0 : undefined} />
              <MetricCard label="PPOP" value={latest.ppop_cr != null ? `₹${fmt(latest.ppop_cr)}Cr` : "—"}
                up={latest.ppop_cr != null ? latest.ppop_cr > 0 : undefined} />
              <MetricCard label={capitalLabel} value={capitalPct != null ? `${fmt(capitalPct)}%` : "—"}
                up={capitalPct != null ? capitalPct > 12 : undefined} />
              <MetricCard label="ROA (Q)" value={latest.roa != null ? `${fmt(latest.roa)}%` : "—"}
                up={latest.roa != null ? latest.roa > 1 : undefined} />
            </div>
          </div>
        );
      })()}
    </>
  );
}
