import { useState } from "react";
import { Info } from "lucide-react";
import type { BankFinancial, Candle, Fundamental, Shareholding, StockRatios } from "../../lib/api";
import AboutCompany from "./AboutCompany";
import AnalystConsensus from "./AnalystConsensus";
import BankKpis from "./BankKpis";
import EpsHistory from "./EpsHistory";
import MetricsGrid from "./MetricsGrid";
import RangeGauge from "./RangeGauge";
import type { MetricsTab } from "./metricsTab";

/** The Key Metrics card: ratio tabs, bank KPIs, EPS history, 52-week range, analyst view and a short description. */
export default function KeyMetricsCard({ ratios, latestFund, latestShare, betaHistory, bankFinancials, last }: {
  ratios: StockRatios | null;
  latestFund: Fundamental | undefined;
  latestShare: Shareholding | undefined;
  betaHistory: { date: string; beta: number }[] | null;
  bankFinancials: BankFinancial[] | null;
  last: Candle | undefined;
}) {
  const [metricsTab, setMetricsTab] = useState<MetricsTab>("valuation");
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Info size={14} className="text-blue-500" />
          <span className="text-sm font-semibold text-slate-700">Key Metrics</span>
        </div>
        <div className="flex items-center gap-2">
          {ratios?.industry && <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded">{ratios.industry}</span>}
          {ratios?.sector && <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded">{ratios.sector}</span>}
        </div>
      </div>

      <MetricsGrid metricsTab={metricsTab} onMetricsTab={setMetricsTab} ratios={ratios} latestFund={latestFund} latestShare={latestShare} betaHistory={betaHistory} />
      <BankKpis metricsTab={metricsTab} bankFinancials={bankFinancials} />
      <EpsHistory ratios={ratios} />
      <RangeGauge ratios={ratios} last={last} />
      <AnalystConsensus ratios={ratios} last={last} />
      <AboutCompany ratios={ratios} />
    </div>
  );
}
