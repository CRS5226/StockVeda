import { RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { usePortfolioDataSync } from "../../lib/usePortfolioDataSync";
import { usePortfolioSignals } from "../../lib/usePortfolioSignals";
import { usePriceSync } from "../../lib/usePriceSync";
import ConcentrationCheck from "./signals/ConcentrationCheck";
import DataSyncPanel from "./signals/DataSyncPanel";
import FundamentalsCheck from "./signals/FundamentalsCheck";
import InsightsPanel from "./signals/InsightsPanel";
import RuleEvidence from "./signals/RuleEvidence";
import SignalsSettings from "./signals/SignalsSettings";
import SignalsTable from "./signals/SignalsTable";

/**
 * Portfolio management for the stocks only: what stands out, the rule scoreboard with each stock's price trend,
 * position sizes, how the rules did on each stock's history, and valuation. Fixed deposits, funds and the like are
 * left out on purpose. Educational maths on prices: rule states and facts, not advice.
 */
export default function SignalsSection({ portfolioId, refreshKey }: { portfolioId: number; refreshKey: number }) {
  const signals = usePortfolioSignals(portfolioId, refreshKey);
  const history = usePriceSync(portfolioId, signals.reload, api.startPriceHistory);
  const data = usePortfolioDataSync(portfolioId);
  const r = signals.report;

  if (signals.error && !r) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{signals.error}</div>;
  if (!r) return <div className="py-10 text-center text-sm text-slate-400">Working out the rules…</div>;
  const s = r.summary;
  const thin = s.stocks > 0 && s.with_sma200 < s.stocks;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        For education only, and only for your stocks. These are what standard indicator rules and plain arithmetic say about past prices, and zones built from settings you choose. They are not advice or suggestions to buy, sell or hold anything, and rules like these often fail after costs; check any idea yourself.
      </div>
      {r.rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No stocks with a quantity, a buy price and a stored price yet. Fill them in on the Stocks tab.</div>
      ) : (
        <>
          <InsightsPanel report={r} />
          {thin && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span>Only {s.with_sma200} of {s.stocks} stocks have 200 days of prices stored, so the 200-day checks cover few of them.</span>
              <button onClick={() => void history.sync()} disabled={history.busy}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-60">
                <RefreshCw size={13} className={history.busy ? "animate-spin" : ""} /> {history.busy ? `Loading ${history.progress.done} of ${history.progress.total}…` : "Load price history"}
              </button>
              {history.message && <span className="w-full text-xs" role="status">{history.message}</span>}
            </div>
          )}
          {signals.error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{signals.error}</div>}
          <SignalsTable rows={r.rows} maxPct={r.settings.max_position_pct} />
          <ConcentrationCheck data={r.concentration} />
          <RuleEvidence portfolioId={portfolioId} />
          <FundamentalsCheck rows={data.rows} />
        </>
      )}
      <SignalsSettings key={JSON.stringify(r.settings)} settings={r.settings} onSave={signals.saveSettings} />
      <DataSyncPanel coverage={data.coverage} job={data.job} busy={data.busy} message={data.message} error={data.error} onSync={() => void data.sync()} />
      <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">
        How to read it: <b>EMA 20/50</b>, <b>price vs 200 average</b>, <b>MACD</b> and <b>20-candle breakout</b> follow the trend; <b>RSI</b> and <b>Bollinger bands</b> look for stretched prices. ADX decides which group counts: trend rules when the market is trending, stretch rules when it is ranging.
      </div>
    </div>
  );
}
