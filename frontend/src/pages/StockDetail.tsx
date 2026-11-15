import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useStockStore } from "../store/useStockStore";
import { useBacktestStore } from "../store/useBacktestStore";
import { api, type StockRatios, type SectorCompareData, type NewsItem, type Holder, type BankFinancial } from "../lib/api";
import type { PatternHit } from "../lib/candlePatterns";
import { stockView, type StockView } from "../lib/connections";
import { rememberStock } from "../lib/recentStocks";
import { fromDate, type Range } from "../lib/stockFormat";
import type { OutlookData } from "../components/TrendOutlook";
import ConnectionsView from "../components/connections/ConnectionsView";
import BacktestTab from "../components/stock/BacktestTab";
import CorpActionsTab from "../components/stock/CorpActionsTab";
import DealsTab, { type StockDeal } from "../components/stock/DealsTab";
import DeliveryTab from "../components/stock/DeliveryTab";
import FundamentalsTab from "../components/stock/FundamentalsTab";
import GlanceStrip from "../components/stock/GlanceStrip";
import KeyMetricsCard from "../components/stock/KeyMetricsCard";
import NewsTab from "../components/stock/NewsTab";
import PriceChartCard from "../components/stock/PriceChartCard";
import SectorCompareCard from "../components/stock/SectorCompareCard";
import ShareholdingTab from "../components/stock/ShareholdingTab";
import StockInfoCard from "../components/stock/StockInfoCard";
import StockTabStrip from "../components/stock/StockTabStrip";
import StockViewSwitch from "../components/stock/StockViewSwitch";
import TechnicalAnalysisCard from "../components/stock/TechnicalAnalysisCard";
import type { FundView, Tab } from "../components/stock/stockTabs";

export default function StockDetail() {
  const { symbol = "" } = useParams<{ symbol: string }>();
  const sym = symbol.toUpperCase();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = stockView(searchParams.get("tab"));
  const setView = (v: StockView) => setSearchParams(v === "connections" ? { tab: "connections" } : {});

  const { candles, fundamentals, delivery, shareholding, corporateActions, insiderTrades, loading,
    fetchCandles, fetchFundamentals, fetchDelivery, fetchShareholding, fetchCorporateActions } = useStockStore();
  const { params, results: btResults, loading: btLoading, error: btError,
    strategies, setParams, applyStrategy, runBacktest, loadStrategies } = useBacktestStore();

  const [range, setRange] = useState<Range>("1Y");
  const [tab, setTab] = useState<Tab>("fundamentals");
  const [fundPeriod, setFundPeriod] = useState<"Q" | "A">("Q");
  const [fundView, setFundView] = useState<FundView>("pl");
  const [stockInfo, setStockInfo] = useState<{ company_name: string | null; isin: string | null } | null>(null);
  const [syncingTab, setSyncingTab] = useState<Tab | null>(null);
  const [prefetching, setPrefetching] = useState(false);
  const [ratios, setRatios] = useState<StockRatios | null>(null);
  const [bankFinancials, setBankFinancials] = useState<BankFinancial[] | null>(null);
  const [sectorCompare, setSectorCompare] = useState<SectorCompareData | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [holdersView, setHoldersView] = useState<"pattern" | "holders">("pattern");
  const [patternHits, setPatternHits] = useState<PatternHit[]>([]);
  const [outlook, setOutlook] = useState<OutlookData | null>(null);
  const [outlookLoading, setOutlookLoading] = useState(false);
  const [stockDeals, setStockDeals] = useState<StockDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [betaHistory, setBetaHistory] = useState<{ date: string; beta: number }[] | null>(null);

  useEffect(() => { fetchCandles(sym, fromDate(range), true); }, [sym, range]);

  useEffect(() => {
    if (tab === "fundamentals") fetchFundamentals(sym, fundPeriod);
    if (tab === "delivery") fetchDelivery(sym, fromDate("1Y"));
    if (tab === "shareholding") fetchShareholding(sym);
    if (tab === "corp") fetchCorporateActions(sym);
    if (tab === "news" && newsItems.length === 0) {
      setNewsLoading(true);
      api.getNews(sym).then(setNewsItems).catch(() => {}).finally(() => setNewsLoading(false));
    }
    if (tab === "deals") {
      setDealsLoading(true);
      api.getBulkDeals([sym], 90)
        .then(r => setStockDeals(r.data.map(d => ({ date: d.date, client_name: d.client_name, client_symbol: d.client_symbol, buy_sell: d.buy_sell, quantity: d.quantity, price: d.price, deal_type: d.deal_type }))))
        .catch(() => setStockDeals([]))
        .finally(() => setDealsLoading(false));
    }
  }, [tab, sym, fundPeriod]);

  useEffect(() => {
    setPatternHits([]);
    setOutlook(null);
    setOutlookLoading(true);
    api.getCandlePatterns(sym).then(setPatternHits).catch(() => {});
    api.getOutlook(sym)
      .then((d) => setOutlook(d as OutlookData))
      .catch(() => {})
      .finally(() => setOutlookLoading(false));
  }, [sym]);

  useEffect(() => {
    loadStrategies(); setParams({ symbol: sym });
    api.getStockInfo(sym).then((info) => { setStockInfo(info); if (info.company_name) rememberStock(sym); }).catch(() => {});

    // Fetch live ratios from yfinance info (non-blocking)
    api.getRatios(sym).then(setRatios).catch(() => {});

    setBetaHistory(null);
    api.getBetaHistory(sym, { window_days: 60 }).then((r) => setBetaHistory(r.history)).catch(() => {});

    // Fetch bank financials (GNPA, NPA, NII etc.) — only for banking stocks
    api.getBankFinancials(sym).then(setBankFinancials).catch(() => {});

    // Sector comparison and institutional holders (non-blocking)
    api.getSectorCompare(sym, 252).then(setSectorCompare).catch(() => {});
    api.getHolders(sym).then(setHolders).catch(() => {});

    // Auto-fetch all missing yfinance data for this symbol on page load
    setPrefetching(true);
    api.prefetchSymbol(sym)
      .then(() => {
        fetchFundamentals(sym, "Q");
        fetchShareholding(sym);
        fetchCorporateActions(sym);
      })
      .catch(() => {})
      .finally(() => setPrefetching(false));
  }, [sym]);

  // Poll an API fn every `interval` ms until it returns data (or `maxWait` ms elapses)
  const pollData = async (apiFn: () => Promise<unknown[]>, maxWait = 90_000, interval = 3_000) => {
    const deadline = Date.now() + maxWait;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      try { if ((await apiFn()).length > 0) return true; } catch { /* not ready yet */ }
    }
    return false;
  };

  const syncTabData = async (source: string, forTab: Tab) => {
    setSyncingTab(forTab);
    try {
      if (["fundamentals", "shareholding", "corporate_actions"].includes(source)) {
        // yfinance-backed: prefetch runs synchronously (~5-10 s)
        await api.prefetchSymbol(sym);
      } else if (source === "bhavcopy" || source === "delivery") {
        await api.triggerSync(source);
        // First bhavcopy sync downloads ~3 months of NSE data (~130 files) and runs in the
        // background — poll for up to 6 min so the chart appears automatically when it lands.
        await pollData(() => api.getDelivery(sym, fromDate("1Y")), 360_000, 5_000);
      }
      // Refresh the relevant store slice so data appears immediately
      if (forTab === "fundamentals") await fetchFundamentals(sym, fundPeriod);
      if (forTab === "delivery")     await fetchDelivery(sym, fromDate("1Y"));
      if (forTab === "shareholding") await fetchShareholding(sym);
      if (forTab === "corp")         await fetchCorporateActions(sym);
    } catch { /* silent */ }
    setSyncingTab(null);
  };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = prev?.close ? (change / prev.close) * 100 : 0;
  const up = change >= 0;
  const latestFund = fundamentals[0];
  const latestShare = shareholding[0];
  const high52 = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : null;
  const low52 = candles.length > 0 ? Math.min(...candles.map(c => c.low)) : null;


  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-slate-400">
        <button onClick={() => navigate("/")} className="hover:text-blue-500 transition-colors">Dashboard</button>
        <ChevronRight size={12} />
        <span className="text-slate-600 font-medium">{sym}</span>
        {stockInfo?.company_name && <span className="text-slate-400">— {stockInfo.company_name}</span>}
        <StockViewSwitch view={view} onView={setView} />
      </div>

      {/* First-load data fetch banner — shown while yfinance data is being downloaded */}
      {(prefetching || loading.candles) && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-2 text-xs">
          <div className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin shrink-0" />
          Fetching the latest data for {sym} from Yahoo Finance — price history, fundamentals,
          shareholding &amp; corporate actions. This may take a few seconds…
        </div>
      )}

      {view === "overview" && <GlanceStrip sym={sym} />}

      {/* Connections: full-width sections. Overview: the 50/50 grid. */}
      {view === "connections" ? <ConnectionsView symbol={sym} /> : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">


          {/* LEFT */}
          <div className="flex flex-col gap-4">
            <StockInfoCard sym={sym} stockInfo={stockInfo} ratios={ratios} last={last} change={change} changePct={changePct}
              up={up} high52={high52} low52={low52} loadingCandles={loading.candles} />
            <KeyMetricsCard ratios={ratios} latestFund={latestFund} latestShare={latestShare} betaHistory={betaHistory}
              bankFinancials={bankFinancials} last={last} />

            {/* Tabs */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <StockTabStrip tab={tab} onTab={setTab} />

              <div className="p-3 min-h-[200px]">
                {tab === "fundamentals" && (
                  <FundamentalsTab fundamentals={fundamentals} fundPeriod={fundPeriod} fundView={fundView}
                    loadingFundamentals={loading.fundamentals} onFundView={setFundView}
                    onFundPeriod={(p) => { setFundPeriod(p); fetchFundamentals(sym, p); }} />
                )}
                {tab === "delivery" && <DeliveryTab delivery={delivery} syncingTab={syncingTab} syncTabData={syncTabData} />}
                {tab === "shareholding" && (
                  <ShareholdingTab sym={sym} shareholding={shareholding} holders={holders} holdersView={holdersView}
                    setHoldersView={setHoldersView} syncingTab={syncingTab} syncTabData={syncTabData} />
                )}
                {tab === "corp" && <CorpActionsTab corporateActions={corporateActions} insiderTrades={insiderTrades} />}
                {tab === "deals" && <DealsTab sym={sym} dealsLoading={dealsLoading} stockDeals={stockDeals} navigate={navigate} />}
                {tab === "news" && <NewsTab newsLoading={newsLoading} newsItems={newsItems} />}
                {tab === "backtest" && (
                  <BacktestTab strategies={strategies} params={params} setParams={setParams} applyStrategy={applyStrategy}
                    runBacktest={runBacktest} btLoading={btLoading} btError={btError} btResults={btResults} />
                )}
              </div>
            </div>

          </div>

          {/* RIGHT — price + sector charts (scroll together; no sticky to avoid overlap) */}
          <div className="flex flex-col">
            <PriceChartCard range={range} onRange={setRange} candles={candles} loadingCandles={loading.candles} />
            <SectorCompareCard sym={sym} sectorCompare={sectorCompare} />
            <TechnicalAnalysisCard sym={sym} candles={candles} patternHits={patternHits} outlook={outlook}
              outlookLoading={outlookLoading} last={last} />
          </div>
        </div>
      )}
    </div>
  );
}
