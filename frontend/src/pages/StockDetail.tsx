import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  TrendingUp, BarChart2, Users, Building2,
  ArrowUpRight, ArrowDownRight, FlaskConical,
  ChevronRight, Calendar, RefreshCw, Info, Newspaper,
} from "lucide-react";
import { useStockStore } from "../store/useStockStore";
import { useBacktestStore } from "../store/useBacktestStore";
import { api, type StockRatios, type SectorCompareData, type NewsItem, type Holder } from "../lib/api";
import CandleChart from "../components/CandleChart";
import BacktestResults from "../components/BacktestResults";
import MacroLineChart from "../components/MacroLineChart";

type Range = "1M" | "3M" | "6M" | "1Y" | "3Y" | "MAX";
type Tab = "fundamentals" | "delivery" | "shareholding" | "corp" | "backtest" | "news";
type SectorRange = "1M" | "3M" | "6M" | "1Y";
type FundView = "pl" | "bs" | "cf";

const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "3Y", "MAX"];
const SECTOR_RANGES: SectorRange[] = ["1M", "3M", "6M", "1Y"];

function fromDate(r: Range) {
  if (r === "MAX") return undefined;
  const d = new Date();
  const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[r];
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
function fmt(n?: number | null, dec = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}
function fmtCr(n?: number | null) {
  if (n == null) return "—";
  return `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}
// Google News RSS pubDate is RFC-822 (e.g. "Wed, 18 Jun 2026 10:30:00 GMT").
function newsTime(pub?: string) {
  const t = pub ? new Date(pub).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}
function fmtNewsDate(pub: string) {
  const t = newsTime(pub);
  if (!t) return pub.slice(0, 16); // fallback if unparseable
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function MetricCard({ label, value, icon: Icon, up }: {
  label: string; value: string; icon?: React.ElementType; up?: boolean;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
        {Icon && <Icon size={11} />}{label}
      </div>
      <div className={`text-sm font-bold ${up === true ? "text-emerald-600" : up === false ? "text-red-500" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "fundamentals", label: "Fundamentals", icon: BarChart2 },
  { id: "delivery", label: "Delivery", icon: TrendingUp },
  { id: "shareholding", label: "Shareholding", icon: Users },
  { id: "corp", label: "Corp Actions", icon: Building2 },
  { id: "news", label: "News", icon: Newspaper },
  { id: "backtest", label: "Backtest", icon: FlaskConical },
];

export default function StockDetail() {
  const { symbol = "" } = useParams<{ symbol: string }>();
  const sym = symbol.toUpperCase();
  const navigate = useNavigate();

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
  const [sectorCompare, setSectorCompare] = useState<SectorCompareData | null>(null);
  const [sectorRange, setSectorRange] = useState<SectorRange>("1Y");
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [holdersView, setHoldersView] = useState<"pattern" | "holders">("pattern");

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
  }, [tab, sym, fundPeriod]);

  useEffect(() => {
    loadStrategies(); setParams({ symbol: sym });
    api.getStockInfo(sym).then((info) => setStockInfo(info)).catch(() => {});

    // Fetch live ratios from yfinance info (non-blocking)
    api.getRatios(sym).then(setRatios).catch(() => {});

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

  // Filter sector comparison data client-side by selected range
  const sectorRangeMs = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365 }[sectorRange] * 86_400_000;
  const sectorCutoff = new Date(Date.now() - sectorRangeMs).toISOString().slice(0, 10);
  const filteredSector = sectorCompare ? {
    ...sectorCompare,
    stock: sectorCompare.stock.filter(p => p.date >= sectorCutoff),
    sector: sectorCompare.sector.filter(p => p.date >= sectorCutoff),
  } : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-slate-400">
        <button onClick={() => navigate("/")} className="hover:text-blue-500 transition-colors">Dashboard</button>
        <ChevronRight size={12} />
        <span className="text-slate-600 font-medium">{sym}</span>
        {stockInfo?.company_name && <span className="text-slate-400">— {stockInfo.company_name}</span>}
      </div>

      {/* First-load data fetch banner — shown while yfinance data is being downloaded */}
      {(prefetching || loading.candles) && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-2 text-xs">
          <div className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin shrink-0" />
          Fetching the latest data for {sym} from Yahoo Finance — price history, fundamentals,
          shareholding &amp; corporate actions. This may take a few seconds…
        </div>
      )}

      {/* 50/50 grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* LEFT */}
        <div className="flex flex-col gap-4">

          {/* Stock info card */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-2xl font-bold text-slate-800">{sym}</span>
                  {stockInfo?.isin && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{stockInfo.isin}</span>
                  )}
                  {ratios?.next_earnings && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                      <Calendar size={10} /> Next earnings: {ratios.next_earnings}
                    </span>
                  )}
                </div>
                {stockInfo?.company_name && (
                  <div className="text-sm text-slate-500 mb-2">{stockInfo.company_name}</div>
                )}
                {last && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-slate-900">₹{fmt(last.close)}</span>
                    <span className={`flex items-center gap-0.5 text-sm font-semibold ${up ? "text-emerald-600" : "text-red-500"}`}>
                      {up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                      {up ? "+" : ""}{fmt(change)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>
              {loading.candles && (
                <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mt-1" />
              )}
            </div>

            {last && (
              <>
                <div className="grid grid-cols-3 gap-3 text-xs mt-3 pt-3 border-t border-slate-100">
                  {[["Open", `₹${fmt(last.open)}`], ["High", `₹${fmt(last.high)}`], ["Low", `₹${fmt(last.low)}`],
                    ["Volume", last.volume?.toLocaleString("en-IN") ?? "—"],
                    ["52W High", high52 ? `₹${fmt(high52)}` : "—"],
                    ["52W Low",  low52  ? `₹${fmt(low52)}`  : "—"],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <span className="block text-slate-400 mb-0.5">{l}</span>
                      <span className="font-medium text-slate-700">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-xs text-slate-400">NSE EOD · data as of {last.date}</span>
                </div>
              </>
            )}
          </div>

          {/* Key metrics */}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricCard label="Market Cap" value={ratios?.market_cap_cr != null ? fmtCr(ratios.market_cap_cr * 1e7) : "—"} icon={BarChart2} />
              <MetricCard label="P/E (TTM)" value={ratios?.pe_ratio != null ? fmt(ratios.pe_ratio) : "—"} />
              <MetricCard label="Fwd P/E" value={ratios?.forward_pe != null ? fmt(ratios.forward_pe) : "—"} />
              <MetricCard label="P/B Ratio" value={ratios?.pb_ratio != null ? fmt(ratios.pb_ratio) : "—"} />
              <MetricCard label="Book Value" value={ratios?.book_value != null ? `₹${fmt(ratios.book_value)}` : "—"} />
              <MetricCard label="EPS (TTM)" value={ratios?.eps_trailing != null ? `₹${fmt(ratios.eps_trailing)}` : "—"} />
              <MetricCard label="Fwd EPS" value={ratios?.eps_forward != null ? `₹${fmt(ratios.eps_forward)}` : "—"} />
              <MetricCard label="Div Yield" value={ratios?.div_yield_pct != null ? `${fmt(ratios.div_yield_pct)}%` : "—"}
                up={ratios?.div_yield_pct != null ? ratios.div_yield_pct > 0 : undefined} />
              <MetricCard label="Payout Ratio" value={ratios?.payout_ratio_pct != null ? `${fmt(ratios.payout_ratio_pct)}%` : "—"} />
              <MetricCard label="ROE" value={ratios?.roe_pct != null ? `${fmt(ratios.roe_pct)}%` : "—"}
                up={ratios?.roe_pct != null ? ratios.roe_pct > 10 : undefined} />
              <MetricCard label="ROA" value={ratios?.roa_pct != null ? `${fmt(ratios.roa_pct)}%` : "—"} />
              <MetricCard label="Net Margin" value={ratios?.profit_margin_pct != null ? `${fmt(ratios.profit_margin_pct)}%` : "—"}
                up={ratios?.profit_margin_pct != null ? ratios.profit_margin_pct > 0 : undefined} />
              <MetricCard label="Op Margin" value={ratios?.operating_margin_pct != null ? `${fmt(ratios.operating_margin_pct)}%` : "—"} />
              <MetricCard label="Beta" value={ratios?.beta != null ? fmt(ratios.beta) : "—"} />
              <MetricCard label="Rev Growth" value={ratios?.revenue_growth_pct != null ? `${fmt(ratios.revenue_growth_pct)}%` : "—"}
                up={ratios?.revenue_growth_pct != null ? ratios.revenue_growth_pct > 0 : undefined} />
              <MetricCard label="PAT (TTM)" value={fmtCr(latestFund?.pat)} icon={TrendingUp}
                up={latestFund?.pat != null ? latestFund.pat >= 0 : undefined} />
              <MetricCard label="Total Debt" value={fmtCr(latestFund?.total_debt)} icon={Building2} />
              <MetricCard label="Promoter %" icon={Users}
                value={latestShare?.promoter_pct != null ? `${fmt(latestShare.promoter_pct)}%` : "—"}
                up={latestShare?.promoter_pct != null ? latestShare.promoter_pct > 50 : undefined} />
              <MetricCard
                label={latestShare?.dii_pct != null ? "FII %" : "Institutional %"}
                icon={Users}
                value={latestShare?.fii_pct != null ? `${fmt(latestShare.fii_pct)}%` : "—"}
              />
              {latestShare?.dii_pct != null && (
                <MetricCard label="DII %" icon={Users} value={`${fmt(latestShare.dii_pct)}%`} />
              )}
            </div>

            {/* 52-Week Range Gauge */}
            {ratios?.["52w_high"] != null && ratios?.["52w_low"] != null && last && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-xs text-slate-400 font-medium mb-2">52-Week Range</div>
                {(() => {
                  const lo = ratios["52w_low"]!;
                  const hi = ratios["52w_high"]!;
                  const pct = Math.min(100, Math.max(0, ((last.close - lo) / (hi - lo)) * 100));
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-16 text-right shrink-0">₹{fmt(lo, 0)}</span>
                      <div className="relative flex-1 h-1.5 bg-slate-200 rounded-full">
                        <div className="absolute inset-y-0 left-0 bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow" style={{ left: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 w-16 shrink-0">₹{fmt(hi, 0)}</span>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Analyst Consensus */}
            {ratios?.target_mean != null && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-xs text-slate-400 font-medium mb-2">Analyst Consensus</div>
                <div className="flex flex-wrap gap-2 items-center">
                  {ratios.recommendation && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${
                      ratios.recommendation.includes("buy") ? "bg-emerald-50 text-emerald-700"
                      : ratios.recommendation.includes("sell") ? "bg-red-50 text-red-600"
                      : "bg-slate-100 text-slate-600"
                    }`}>{ratios.recommendation.replace(/_/g, " ")}</span>
                  )}
                </div>

                {/* Rating breakdown (current) + trend vs oldest period */}
                {ratios.recommendations_summary && ratios.recommendations_summary.length > 0 && (() => {
                  const cur = ratios.recommendations_summary![0];
                  const old = ratios.recommendations_summary![ratios.recommendations_summary!.length - 1];
                  const total = cur.strongBuy + cur.buy + cur.hold + cur.sell + cur.strongSell || 1;
                  // Consensus score in [-1, 1]: strongBuy=+1 … strongSell=-1, weighted by count.
                  const score = (s: typeof cur) => {
                    const n = s.strongBuy + s.buy + s.hold + s.sell + s.strongSell || 1;
                    return (s.strongBuy * 1 + s.buy * 0.5 + s.hold * 0 + s.sell * -0.5 + s.strongSell * -1) / n;
                  };
                  const delta = score(cur) - score(old);
                  const trend = delta > 0.02 ? { t: "▲ improving vs 3m ago", c: "text-emerald-600" }
                              : delta < -0.02 ? { t: "▼ weakening vs 3m ago", c: "text-red-500" }
                              : { t: "→ stable vs 3m ago", c: "text-slate-400" };
                  const ROWS: [string, number, string][] = [
                    ["Strong Buy",  cur.strongBuy,  "bg-emerald-600"],
                    ["Buy",         cur.buy,        "bg-emerald-400"],
                    ["Hold",        cur.hold,       "bg-slate-300"],
                    ["Sell",        cur.sell,       "bg-red-400"],
                    ["Strong Sell", cur.strongSell, "bg-red-600"],
                  ];
                  return (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-slate-400">{total} analysts</span>
                        <span className={`text-xs font-medium ${trend.c}`}>{trend.t}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {ROWS.map(([label, count, color]) => (
                          <div key={label} className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${color}`} style={{ width: `${(count / total) * 100}%` }} />
                            </div>
                            <span className="text-xs text-slate-600 w-5 text-right tabular-nums">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Price-target gauge — current price within the low–mean–high range */}
                {last && ratios.target_low != null && ratios.target_high != null && (() => {
                  const lo = ratios.target_low!, hi = ratios.target_high!, mean = ratios.target_mean!;
                  const now = last.close;
                  // Extend the scale so the current price is always visible (it can sit below "low").
                  const sMin = Math.min(lo, now), sMax = Math.max(hi, now);
                  const span = sMax - sMin || 1;
                  const pos = (v: number) => Math.min(100, Math.max(0, ((v - sMin) / span) * 100));
                  return (
                    <div className="mt-3">
                      <div className="text-xs text-slate-400 font-medium mb-2">Price target</div>
                      <div className="relative h-2 bg-slate-100 rounded-full mb-1">
                        {/* analyst low→high band */}
                        <div className="absolute inset-y-0 bg-emerald-200 rounded-full"
                          style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
                        {/* mean target marker */}
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-4 bg-emerald-600 rounded"
                          style={{ left: `${pos(mean)}%` }} title={`Mean ₹${fmt(mean)}`} />
                        {/* current price marker */}
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-blue-500 rounded-full shadow"
                          style={{ left: `${pos(now)}%` }} title={`Now ₹${fmt(now)}`} />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-blue-600 font-medium">now ₹{fmt(now)}</span>
                        <span className="text-slate-500">
                          mean <span className="font-medium text-slate-700">₹{fmt(mean)}</span>{" "}
                          <span className={mean > now ? "text-emerald-600" : "text-red-500"}>
                            {mean > now ? "▲" : "▼"} {Math.abs(((mean - now) / now) * 100).toFixed(1)}%
                          </span>
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                        <span>low ₹{fmt(lo)}</span>
                        <span>high ₹{fmt(hi)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* About */}
            {ratios?.description && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-xs text-slate-400 font-medium mb-1.5">About</div>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{ratios.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                  {ratios.employees && <span>{ratios.employees.toLocaleString("en-IN")} employees</span>}
                  {ratios.website && <a href={ratios.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{ratios.website.replace(/^https?:\/\//, "")}</a>}
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex overflow-x-auto border-b border-slate-100">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    tab === id ? "border-blue-500 text-blue-600 bg-blue-50/50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}>
                  <Icon size={12} />{label}
                </button>
              ))}
            </div>

            <div className="p-3 min-h-[200px]">
              {tab === "fundamentals" && (() => {
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
                          <button key={v} onClick={() => setFundView(v)}
                            className={`text-xs px-2.5 py-1 rounded-md ${fundView === v ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        {(["Q", "A"] as const).map((p) => (
                          <button key={p} onClick={() => { setFundPeriod(p); fetchFundamentals(sym, p); }}
                            className={`text-xs px-2 py-1 rounded-md ${fundPeriod === p ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {p === "Q" ? "Quarterly" : "Annual"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {loading.fundamentals ? (
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
              })()}

              {tab === "delivery" && (
                syncingTab === "delivery" ? (
                  <div className="flex flex-col items-center gap-2 py-10 px-4">
                    <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                    <div className="text-xs font-medium text-slate-600">Sync started — running in the background</div>
                    <div className="text-xs text-slate-400 text-center max-w-sm">
                      Downloading the last ~3 months of NSE bhavcopy (price + delivery, ~130 files).
                      The first sync takes a few minutes. You can keep using the app — the chart
                      will appear here automatically when it's ready, or just refresh shortly.
                    </div>
                  </div>
                ) : delivery.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <div className="text-xs text-slate-400 text-center">
                      Delivery data comes from NSE bhavcopy — not available via yfinance.
                      The first sync downloads ~3 months of history (a few minutes).
                    </div>
                    <button onClick={() => syncTabData("bhavcopy", "delivery")} disabled={syncingTab !== null}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 text-slate-600 transition-all disabled:opacity-50">
                      <RefreshCw size={11} /> Sync bhavcopy
                    </button>
                  </div>
                ) : (
                  <MacroLineChart title="Delivery %" height={160}
                    series={[{ label: "Delivery %", color: "#10b981", data: delivery.map((d) => ({ date: d.date, value: d.delivery_pct })) }]} />
                )
              )}

              {tab === "shareholding" && (
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
              )}

              {tab === "corp" && (
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
              )}

              {tab === "news" && (
                newsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : newsItems.length === 0 ? (
                  <div className="text-xs text-slate-400 py-6 text-center">No recent news available.</div>
                ) : (
                  <div className="flex flex-col divide-y divide-slate-50">
                    {[...newsItems]
                      .sort((a, b) => newsTime(b.published_at) - newsTime(a.published_at))
                      .map((item, i) => (
                      <div key={i} className="py-2.5 first:pt-0">
                        <a href={item.link} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-medium text-slate-700 hover:text-blue-600 transition-colors leading-snug block mb-1">
                          {item.title}
                        </a>
                        <div className="flex gap-2 text-xs text-slate-400">
                          {item.source && <span>{item.source}</span>}
                          {item.published_at && <span>· {fmtNewsDate(item.published_at)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {tab === "backtest" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <select value={strategies.findIndex((s) => s.params.entry_col === params.entry_col && s.params.entry_threshold_col === params.entry_threshold_col)}
                      onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) applyStrategy(s); }}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none">
                      <option value="-1">Custom</option>
                      {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                    </select>
                    <input type="date" value={params.from_date} onChange={(e) => setParams({ from_date: e.target.value })}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
                    <input type="date" value={params.to_date} onChange={(e) => setParams({ to_date: e.target.value })}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
                    <input type="number" value={params.initial_capital} onChange={(e) => setParams({ initial_capital: Number(e.target.value) })}
                      placeholder="Capital ₹" className="w-28 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
                    <button onClick={runBacktest} disabled={btLoading}
                      className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors">
                      <FlaskConical size={12} />{btLoading ? "Running…" : "Run"}
                    </button>
                  </div>
                  {btError && <div className="text-red-500 text-xs">{btError}</div>}
                  {btResults && <BacktestResults results={btResults} />}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* RIGHT — price + sector charts (scroll together; no sticky to avoid overlap) */}
        <div className="flex flex-col">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100">
              <Calendar size={12} className="text-slate-400 mr-1" />
              {RANGES.map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    range === r ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}>
                  {r}
                </button>
              ))}
            </div>
            <CandleChart candles={candles} loading={loading.candles} />
          </div>

          {/* Sector Comparison Chart — kept alongside the candle chart so all price/return charts sit together */}
          {filteredSector && filteredSector.stock.length > 1 && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">
                  {sym} vs {filteredSector.sector_name}
                </span>
                <div className="flex gap-1">
                  {SECTOR_RANGES.map((r) => (
                    <button key={r} onClick={() => setSectorRange(r)}
                      className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                        sectorRange === r ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <MacroLineChart height={150} title=""
                series={[
                  { label: sym, color: "#10b981", data: filteredSector.stock.map(p => ({ date: p.date, value: p.pct })) },
                  { label: filteredSector.sector_name, color: "#94a3b8", data: filteredSector.sector.map(p => ({ date: p.date, value: p.pct })) },
                ]}
              />
              <div className="flex gap-4 mt-1">
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="inline-block w-3 h-0.5 bg-emerald-400 rounded" />{sym}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="inline-block w-3 h-0.5 bg-slate-400 rounded" />{filteredSector.sector_name}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
