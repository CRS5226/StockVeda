import { TrendingUp, BarChart2, Users, Building2 } from "lucide-react";
import MacroLineChart from "../MacroLineChart";
import MetricCard from "./MetricCard";
import { fmt, fmtCr } from "../../lib/stockFormat";
import type { Fundamental, Shareholding, StockRatios } from "../../lib/api";
import type { MetricsTab } from "./metricsTab";

/** The Key Metrics tab strip, the metric cards for the chosen tab and the rolling beta chart. */
export default function MetricsGrid({ metricsTab, onMetricsTab, ratios, latestFund, latestShare, betaHistory }: {
  metricsTab: MetricsTab;
  onMetricsTab: (t: MetricsTab) => void;
  ratios: StockRatios | null;
  latestFund: Fundamental | undefined;
  latestShare: Shareholding | undefined;
  betaHistory: { date: string; beta: number }[] | null;
}) {
  return (
    <>
      {/* Metrics tab strip */}
      <div className="flex gap-1 mb-3 border-b border-slate-100 pb-2">
        {(["valuation", "returns", "financials", "ownership"] as const).map((t) => (
          <button key={t} onClick={() => onMetricsTab(t)}
            className={`px-2.5 py-1 text-xs rounded-md font-medium capitalize transition-colors
              ${metricsTab === t ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>
            {t === "returns" ? "Returns" : t === "financials" ? "Financials" : t === "ownership" ? "Ownership" : "Valuation"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {metricsTab === "valuation" && (<>
          <MetricCard label="Market Cap" value={ratios?.market_cap_cr != null ? fmtCr(ratios.market_cap_cr * 1e7) : "—"} icon={BarChart2} />
          <MetricCard label="P/E (TTM)" value={ratios?.pe_ratio != null ? fmt(ratios.pe_ratio) : "—"} />
          <MetricCard label="Fwd P/E" value={ratios?.forward_pe != null ? fmt(ratios.forward_pe) : "—"} />
          <MetricCard label="P/B Ratio" value={ratios?.pb_ratio != null ? fmt(ratios.pb_ratio) : "—"} />
          <MetricCard label="Book Value" value={ratios?.book_value != null ? `₹${fmt(ratios.book_value)}` : "—"} />
          <MetricCard label="PEG Ratio" value={ratios?.peg_ratio != null ? fmt(ratios.peg_ratio) : "—"}
            up={ratios?.peg_ratio != null ? ratios.peg_ratio < 1 : undefined} />
          {ratios?.ev_to_ebitda != null && (
            <MetricCard label="EV/EBITDA" value={fmt(ratios.ev_to_ebitda)} up={ratios.ev_to_ebitda < 15} />
          )}
          {ratios?.price_to_sales != null && (
            <MetricCard label="P/S Ratio" value={fmt(ratios.price_to_sales)} />
          )}
          <MetricCard label="EPS (TTM)" value={ratios?.eps_trailing != null ? `₹${fmt(ratios.eps_trailing)}` : "—"} />
          <MetricCard label="Fwd EPS" value={ratios?.eps_forward != null ? `₹${fmt(ratios.eps_forward)}` : "—"} />
          <MetricCard label="Face Value" value={ratios?.face_value != null ? `₹${ratios.face_value}` : "—"} />
          <MetricCard label="Beta" value={ratios?.beta != null ? fmt(ratios.beta) : "—"} />
          <MetricCard
            label={`Beta vs ${ratios?.beta_computed?.index_symbol ?? "NIFTY"}`}
            value={ratios?.beta_computed?.beta != null ? fmt(ratios.beta_computed.beta) : "—"}
          />
        </>)}

        {metricsTab === "returns" && (<>
          <MetricCard label="ROE" value={ratios?.roe_pct != null ? `${fmt(ratios.roe_pct)}%` : "—"}
            up={ratios?.roe_pct != null ? ratios.roe_pct > 10 : undefined} />
          <MetricCard label="ROA" value={ratios?.roa_pct != null ? `${fmt(ratios.roa_pct)}%` : "—"}
            up={ratios?.roa_pct != null ? ratios.roa_pct > 1 : undefined} />
          <MetricCard label="ROCE" value={ratios?.roce_pct != null ? `${fmt(ratios.roce_pct)}%` : "—"}
            up={ratios?.roce_pct != null ? ratios.roce_pct > 10 : undefined} />
          <MetricCard label="Net Margin" value={ratios?.profit_margin_pct != null ? `${fmt(ratios.profit_margin_pct)}%` : "—"}
            up={ratios?.profit_margin_pct != null ? ratios.profit_margin_pct > 0 : undefined} />
          <MetricCard label="Op Margin" value={ratios?.operating_margin_pct != null ? `${fmt(ratios.operating_margin_pct)}%` : "—"}
            up={ratios?.operating_margin_pct != null ? ratios.operating_margin_pct > 0 : undefined} />
          {ratios?.debt_to_equity != null && (
            <MetricCard label="Debt/Equity" value={fmt(ratios.debt_to_equity)} up={ratios.debt_to_equity < 1} />
          )}
        </>)}

        {metricsTab === "financials" && (<>
          <MetricCard label="PAT (TTM)" value={fmtCr(latestFund?.pat)} icon={TrendingUp}
            up={latestFund?.pat != null ? latestFund.pat >= 0 : undefined} />
          <MetricCard label="Rev Growth" value={ratios?.revenue_growth_pct != null ? `${fmt(ratios.revenue_growth_pct)}%` : "—"}
            up={ratios?.revenue_growth_pct != null ? ratios.revenue_growth_pct > 0 : undefined} />
          <MetricCard label="Total Debt" value={fmtCr(latestFund?.total_debt)} icon={Building2} />
          {ratios?.fcf_cr != null && (
            <MetricCard label="Free CF" value={fmtCr(ratios.fcf_cr * 1e7)} up={ratios.fcf_cr > 0} />
          )}
          {ratios?.sales_cagr_3y != null && (
            <MetricCard label="Sales CAGR 3Y" value={`${fmt(ratios.sales_cagr_3y)}%`} up={ratios.sales_cagr_3y > 10} />
          )}
          {ratios?.profit_cagr_3y != null && (
            <MetricCard label="PAT CAGR 3Y" value={`${fmt(ratios.profit_cagr_3y)}%`} up={ratios.profit_cagr_3y > 10} />
          )}
        </>)}

        {metricsTab === "ownership" && (<>
          <MetricCard label="Promoter %" icon={Users}
            value={latestShare?.promoter_pct != null ? `${fmt(latestShare.promoter_pct)}%` : "—"}
            up={latestShare?.promoter_pct != null ? latestShare.promoter_pct > 50 : undefined} />
          <MetricCard
            label={latestShare?.dii_pct != null ? "FII %" : "Institutional %"} icon={Users}
            value={latestShare?.fii_pct != null ? `${fmt(latestShare.fii_pct)}%` : "—"} />
          {latestShare?.dii_pct != null && (
            <MetricCard label="DII %" icon={Users} value={`${fmt(latestShare.dii_pct)}%`} />
          )}
          {latestShare?.mf_pct != null && (
            <MetricCard label="MF %" icon={Users} value={`${fmt(latestShare.mf_pct)}%`} />
          )}
          <MetricCard label="Div Yield" value={ratios?.div_yield_pct != null ? `${fmt(ratios.div_yield_pct)}%` : "—"}
            up={ratios?.div_yield_pct != null ? ratios.div_yield_pct > 0 : undefined} />
          <MetricCard label="Payout Ratio" value={ratios?.payout_ratio_pct != null ? `${fmt(ratios.payout_ratio_pct)}%` : "—"} />
          {ratios?.div_streak != null && ratios.div_streak > 0 && (
            <MetricCard label="Div Streak" value={`${ratios.div_streak} yrs ↑`} up={ratios.div_streak >= 3} />
          )}
        </>)}
      </div>

      {metricsTab === "valuation" && betaHistory && betaHistory.length > 1 && (
        <div className="mt-3">
          <div className="text-xs text-slate-400 mb-1">
            Rolling 60-day Beta vs {ratios?.beta_computed?.index_symbol ?? "NIFTY"} (computed from our own OHLCV data)
          </div>
          <MacroLineChart
            height={140}
            series={[{ label: "Beta", color: "#60a5fa", data: betaHistory.map((h) => ({ date: h.date, value: h.beta })) }]}
          />
        </div>
      )}
    </>
  );
}
