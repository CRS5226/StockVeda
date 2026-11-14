import { RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { pct } from "../../lib/healthLabels";
import { usePortfolioDataSync } from "../../lib/usePortfolioDataSync";
import { usePortfolioHealth } from "../../lib/usePortfolioHealth";
import { usePriceSync } from "../../lib/usePriceSync";
import DataSyncPanel from "./health/DataSyncPanel";
import FundamentalsCheck from "./health/FundamentalsCheck";
import AllocationCheck from "./health/AllocationCheck";
import ConcentrationCheck from "./health/ConcentrationCheck";
import HealthTargets from "./health/HealthTargets";
import TrendCheck from "./health/TrendCheck";
import StatCards from "./StatCards";

/** Checks the portfolio against targets the user sets: concentration, drift of each type, and the trend of each stock. */
export default function HealthSection({ portfolioId, refreshKey }: { portfolioId: number; refreshKey: number }) {
  const health = usePortfolioHealth(portfolioId, refreshKey);
  const history = usePriceSync(portfolioId, health.reload, api.startPriceHistory);
  const data = usePortfolioDataSync(portfolioId);
  const r = health.report;

  if (health.error && !r) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{health.error}</div>;
  if (!r) return <div className="py-10 text-center text-sm text-slate-400">Checking the portfolio…</div>;

  const s = r.summary;
  const thin = s.stocks > 0 && s.with_sma200 < s.stocks;
  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        These are checks against targets you set and facts about prices. They are not recommendations to buy or sell, and they do not predict anything.
      </div>
      <StatCards items={[
        { label: "Stocks checked", value: String(s.stocks) },
        { label: "Top 5 stocks hold", value: pct(r.concentration.top5_pct) },
        { label: "Above your size limit", value: String(r.concentration.over_limit), tone: r.concentration.over_limit > 0 ? "text-amber-600" : undefined, hint: `Limit: ${r.settings.max_position_pct}% of the portfolio in one stock` },
        { label: "Below 200-day average", value: `${s.below_sma200} of ${s.with_sma200}`, tone: s.below_sma200 > 0 ? "text-amber-600" : undefined, hint: "Only stocks with 200 days of prices are counted" },
        { label: "Far from 52-week high", value: String(s.deep_drawdown), tone: s.deep_drawdown > 0 ? "text-red-600" : undefined, hint: "25% or more below the highest close of the year" },
      ]} />
      {thin && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span>Only {s.with_sma200} of {s.stocks} stocks have 200 days of prices stored, so the trend checks cover few of them.</span>
          <button onClick={() => void history.sync()} disabled={history.busy}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-60">
            <RefreshCw size={13} className={history.busy ? "animate-spin" : ""} /> {history.busy ? `Loading ${history.progress.done} of ${history.progress.total}…` : "Load price history"}
          </button>
          {history.message && <span className="w-full text-xs" role="status">{history.message}</span>}
        </div>
      )}
      {health.error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{health.error}</div>}
      <DataSyncPanel coverage={data.coverage} job={data.job} busy={data.busy} message={data.message} error={data.error} onSync={() => void data.sync()} />
      <HealthTargets key={JSON.stringify(r.settings)} settings={r.settings} onSave={health.saveSettings} />
      <AllocationCheck rows={r.allocation} band={r.settings.band_pp} />
      <ConcentrationCheck data={r.concentration} />
      <TrendCheck trend={r.trend} />
      <FundamentalsCheck rows={data.rows} />
    </div>
  );
}
