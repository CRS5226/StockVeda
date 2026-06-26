import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createChart, type IChartApi, type ISeriesApi,
  type LineData, type CandlestickData, type HistogramData,
  type SeriesMarker, type Time, ColorType, CrosshairMode,
} from "lightweight-charts";
import {
  TrendingUp, ArrowUpRight, ArrowDownRight,
  DollarSign, Activity, BarChart2, Globe, SlidersHorizontal,
  FlaskConical, Zap, Newspaper,
} from "lucide-react";
import { api, type DashboardData, type NewsItem } from "../lib/api";
import type { PatternHit } from "../lib/candlePatterns";

type FiiRow = { date: string; fii_net: number; dii_net: number };

// ── helpers ────────────────────────────────────────────────────────────────

function fmtNum(n: number, dec = 2) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function fmtDate(d?: string) {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function pctBg(p: number) {
  return p >= 0
    ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
    : "bg-red-50 border-red-200 hover:bg-red-100";
}

const INDEX_SHORT: Record<string, string> = {
  "NIFTY 50":         "Nifty 50",
  "NIFTY BANK":       "Bank Nifty",
  "SENSEX":           "Sensex",
  "NIFTY MIDCAP 100": "Midcap 100",
};

const HEADLINE_INDICES = ["NIFTY 50", "NIFTY BANK", "SENSEX", "NIFTY MIDCAP 100"];
const INDEX_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#a78bfa"];

const CANDLE_BARS: Record<string, number> = {
  MS: 3, ES: 3, "3W": 3, "3B": 3,
  E: 2, BE: 2, P: 2, DC: 2,
  H: 1, IH: 1, SS: 1, DD: 1, GD: 1, M: 1,
};

// ── sub-components ─────────────────────────────────────────────────────────

function IndexTile({ idx }: { idx: DashboardData["headline"][number] }) {
  const up = idx.change_pct >= 0;
  const label = INDEX_SHORT[idx.name] ?? idx.name.replace("NIFTY ", "");
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate pr-1">{label}</span>
        {up ? <ArrowUpRight size={14} className="text-emerald-500 shrink-0" /> : <ArrowDownRight size={14} className="text-red-500 shrink-0" />}
      </div>
      <div className="text-lg font-bold text-slate-800">{fmtNum(idx.close, 2)}</div>
      <div className={`text-xs font-semibold mt-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
        <span className="text-slate-400 font-normal ml-1">({up ? "+" : ""}{fmtNum(idx.change, 2)})</span>
      </div>
      {idx.date && <div className="text-[10px] text-slate-300 mt-1">as of {fmtDate(idx.date)}</div>}
    </div>
  );
}

function MktTile({ name, close, change_pct, change, region, date }: {
  name: string; close: number; change_pct: number; change: number; region?: string; date?: string;
}) {
  const up = change_pct >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate pr-1">{name}</span>
        {up ? <ArrowUpRight size={14} className="text-emerald-500 shrink-0" /> : <ArrowDownRight size={14} className="text-red-500 shrink-0" />}
      </div>
      {region && <div className="text-[10px] text-slate-400 mb-1">{region}</div>}
      <div className="text-lg font-bold text-slate-800">{fmtNum(close, 2)}</div>
      <div className={`text-xs font-semibold mt-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? "+" : ""}{change_pct.toFixed(2)}%
        <span className="text-slate-400 font-normal ml-1">({up ? "+" : ""}{fmtNum(change, 2)})</span>
      </div>
      {date && <div className="text-[10px] text-slate-300 mt-1">as of {fmtDate(date)}</div>}
    </div>
  );
}

function SectorCard({ s }: { s: { name: string; pct: number } }) {
  const up = s.pct >= 0;
  return (
    <div className={`border rounded-lg p-2 transition-colors cursor-default ${pctBg(s.pct)}`}>
      <div className="text-[11px] font-semibold text-slate-600 truncate leading-tight">{s.name}</div>
      <div className={`text-sm font-bold mt-0.5 ${up ? "text-emerald-700" : "text-red-600"}`}>
        {up ? "+" : ""}{s.pct.toFixed(2)}%
      </div>
    </div>
  );
}

// ── FII / DII net flow chart ────────────────────────────────────────────────

function FiiDiiChart({ rows }: { rows: FiiRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || !rows.length) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#64748b" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      rightPriceScale: { borderColor: "#f1f5f9" },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "#f1f5f9", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth,
      height: 160,
    });
    chartRef.current = chart;

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

    const fiiS = chart.addLineSeries({ color: "#3b82f6", lineWidth: 2, priceLineVisible: false, title: "FII Net" });
    fiiS.setData(sorted.map(r => ({ time: r.date.slice(0, 10) as Time, value: r.fii_net / 100 } as LineData)));

    const diiS = chart.addLineSeries({ color: "#10b981", lineWidth: 2, priceLineVisible: false, title: "DII Net" });
    diiS.setData(sorted.map(r => ({ time: r.date.slice(0, 10) as Time, value: r.dii_net / 100 } as LineData)));

    // Zero baseline
    const zero = chart.addLineSeries({ color: "#cbd5e1", lineWidth: 1, lineStyle: 2, priceLineVisible: false });
    zero.setData(sorted.map(r => ({ time: r.date.slice(0, 10) as Time, value: 0 } as LineData)));

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [rows]);

  return <div ref={containerRef} className="w-full" />;
}

function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={13} className="text-slate-400" />
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{children}</span>
    </div>
  );
}

// ── Multi-index % return chart ──────────────────────────────────────────────

interface IndexSeries { name: string; data: { date: string; close: number }[] }

function IndexMultiChart({ indices }: { indices: IndexSeries[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!containerRef.current || !indices.length) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#64748b" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      rightPriceScale: { borderColor: "#f1f5f9" },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "#f1f5f9", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth,
      height: 200,
    });
    chartRef.current = chart;

    indices.forEach((idx, i) => {
      if (!idx.data.length) return;
      const base = idx.data[0].close;
      const series = chart.addLineSeries({
        color: INDEX_COLORS[i % INDEX_COLORS.length],
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
      });
      series.setData(
        idx.data.map(d => ({
          time: d.date as Time,
          value: base > 0 ? ((d.close - base) / base) * 100 : 0,
        } as LineData))
      );
      seriesRef.current.set(idx.name, series);
    });
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current.clear(); };
  }, [indices]);

  const toggle = (name: string) => {
    const s = seriesRef.current.get(name);
    if (!s) return;
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); s.applyOptions({ visible: true }); }
      else { next.add(name); s.applyOptions({ visible: false }); }
      return next;
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        {indices.map((idx, i) => (
          <button key={idx.name} onClick={() => toggle(idx.name)}
            className={`flex items-center gap-1.5 text-xs font-medium transition-opacity ${hidden.has(idx.name) ? "opacity-30" : "opacity-100"}`}>
            <span className="w-3 h-0.5 inline-block rounded-full" style={{ backgroundColor: INDEX_COLORS[i % INDEX_COLORS.length] }} />
            {INDEX_SHORT[idx.name] ?? idx.name}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

// ── Index candlestick chart with pattern markers ────────────────────────────

interface OHLCRow { date: string; open: number; high: number; low: number; close: number }

function IndexCandleChart({ ohlcv, patterns, loading }: {
  ohlcv: OHLCRow[]; patterns: PatternHit[]; loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#64748b" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      rightPriceScale: { borderColor: "#f1f5f9" },
      timeScale: { borderColor: "#f1f5f9", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth,
      height: 200,
    });
    chartRef.current = chart;

    const cs = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      borderVisible: false,
    });
    candleRef.current = cs;

    const vs = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volRef.current = vs;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null; volRef.current = null; };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volRef.current || !ohlcv.length) return;
    candleRef.current.setData(
      ohlcv.map(c => ({ time: c.date as unknown as Time, open: c.open, high: c.high, low: c.low, close: c.close } as CandlestickData))
    );
    volRef.current.setData(
      ohlcv.map(c => ({ time: c.date as unknown as Time, value: 0, color: c.close >= c.open ? "#dcfce7" : "#fee2e2" } as HistogramData))
    );
    chartRef.current?.timeScale().fitContent();
  }, [ohlcv]);

  useEffect(() => {
    if (!candleRef.current || !ohlcv.length) return;
    const last10 = new Set(ohlcv.slice(-10).map(r => r.date.slice(0, 10)));
    const markers: SeriesMarker<Time>[] = patterns
      .filter(h => last10.has(h.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(h => ({
        time: h.date as unknown as Time,
        position: h.bias === "bullish" ? "belowBar" : "aboveBar",
        color: h.bias === "bullish" ? "#22c55e" : "#ef4444",
        shape: h.bias === "bullish" ? "arrowUp" : "arrowDown",
        text: h.pattern,
      }));
    candleRef.current.setMarkers(markers);
  }, [ohlcv, patterns]);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <div className="w-4 h-4 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

// ── News card ───────────────────────────────────────────────────────────────

function NewsCard({ item }: { item: NewsItem }) {
  const when = (() => {
    try {
      const d = new Date(item.published_at);
      const diff = Date.now() - d.getTime();
      const h = Math.floor(diff / 3_600_000);
      if (h < 1) return `${Math.floor(diff / 60_000)}m ago`;
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    } catch { return ""; }
  })();
  return (
    <a href={item.link} target="_blank" rel="noopener noreferrer"
      className="block py-2 hover:bg-slate-50 px-1 rounded transition-colors group border-b border-slate-100 last:border-0">
      <div className="text-xs font-medium text-slate-700 group-hover:text-blue-600 leading-snug line-clamp-2">
        {item.title}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {item.source && <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{item.source}</span>}
        {when && <span className="text-[10px] text-slate-300 shrink-0">{when}</span>}
      </div>
    </a>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function MarketDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [indiaNews, setIndiaNews] = useState<NewsItem[]>([]);
  const [globalNews, setGlobalNews] = useState<NewsItem[]>([]);
  const [fiiHistory, setFiiHistory] = useState<FiiRow[]>([]);

  // Chart tab: "perf" = normalized % chart, or an index name
  const [chartTab, setChartTab] = useState<string>("perf");
  const [indexOHLCV, setIndexOHLCV] = useState<OHLCRow[]>([]);
  const [indexPatterns, setIndexPatterns] = useState<PatternHit[]>([]);
  const [indexLoading, setIndexLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const status = await api.dashboardStatus();
        if (cancelled) return;
        if (!status.populated) {
          setSeeding(true);
          await api.bootstrap();
          if (cancelled) return;
        }
        const d = await api.getDashboard();
        if (cancelled) return;
        setData(d);
        setSeeding(false);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setSeeding(false);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    api.getMarketNews().then(setIndiaNews).catch(() => {});
    api.getGlobalNews().then(setGlobalNews).catch(() => {});
    api.getFiiDiiHistory(252).then(rows => setFiiHistory(rows.map(r => ({ date: r.date, fii_net: r.fii_net, dii_net: r.dii_net })))).catch(() => {});
  }, []);

  useEffect(() => {
    if (chartTab === "perf") return;
    setIndexOHLCV([]);
    setIndexPatterns([]);
    setIndexLoading(true);
    Promise.all([
      api.getIndexOHLCV(chartTab, 90),
      api.getIndexCandlePatterns(chartTab),
    ]).then(([ohlcv, pats]) => {
      setIndexOHLCV((ohlcv ?? []).map(r => ({ date: r.date.slice(0, 10), open: r.open, high: r.high, low: r.low, close: r.close })).sort((a, b) => a.date.localeCompare(b.date)));
      setIndexPatterns(pats ?? []);
    }).catch(() => {}).finally(() => setIndexLoading(false));
  }, [chartTab]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-10 h-10 border-[3px] border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        {seeding ? (
          <>
            <div className="text-slate-600 text-sm font-medium">Setting up for the first time…</div>
            <div className="text-xs text-slate-400 text-center max-w-xs">
              Downloading market data. This runs once and takes ~30s.
            </div>
          </>
        ) : (
          <div className="text-slate-500 text-sm">Loading market data…</div>
        )}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <Activity size={32} className="text-slate-300 mx-auto mb-3" />
        <div className="text-sm text-slate-500">Failed to load dashboard</div>
        <div className="text-xs text-slate-400 mt-1">{error}</div>
      </div>
    );
  }

  const { headline, sector_perf, indices_hist, fii_latest, usdinr, india_vix,
          us_markets, us_sectors, global_markets } = data;
  const curChange = usdinr?.change_pct ?? 0;
  const vixChange = india_vix?.change_pct ?? 0;

  // Recent patterns for the active index tab (last 10 trading days)
  const last10 = new Set(indexOHLCV.slice(-10).map(r => r.date.slice(0, 10)));
  const recentPats = indexPatterns.filter(h => last10.has(h.date));

  return (
    <div className="flex flex-col gap-5">

      {/* ── Indian Headline Indices ── */}
      <section>
        <SectionLabel icon={BarChart2}>Indian Markets</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {headline.map((idx) => <IndexTile key={idx.name} idx={idx} />)}
        </div>
      </section>

      {/* ── Chart section with tabs ── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-slate-100 px-4 overflow-x-auto">
          <button
            onClick={() => setChartTab("perf")}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              chartTab === "perf" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            Performance %
          </button>
          {HEADLINE_INDICES.map(name => (
            <button key={name}
              onClick={() => setChartTab(name)}
              className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                chartTab === name ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {INDEX_SHORT[name] ?? name}
            </button>
          ))}
        </div>

        {/* Chart content */}
        <div className="p-4">
          {chartTab === "perf" ? (
            (indices_hist ?? []).length > 0 ? (
              <IndexMultiChart indices={indices_hist} />
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No data</div>
            )
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Candlestick chart */}
              <div className="lg:col-span-2">
                <div className="text-xs text-slate-400 mb-2">
                  {INDEX_SHORT[chartTab] ?? chartTab} — Last 90 days · patterns marked (last 10 sessions)
                </div>
                <IndexCandleChart ohlcv={indexOHLCV} patterns={indexPatterns} loading={indexLoading && !indexOHLCV.length} />
              </div>

              {/* Pattern sidebar */}
              <div className="border-l border-slate-100 pl-4 flex flex-col gap-1.5 overflow-y-auto max-h-64">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  Recent Patterns (last 10 sessions)
                </div>
                {indexLoading && !recentPats.length ? (
                  <div className="text-xs text-slate-400 py-4 text-center">Loading…</div>
                ) : recentPats.length === 0 ? (
                  <div className="text-xs text-slate-400 py-4 text-center">No patterns in last 10 sessions</div>
                ) : (
                  recentPats.map((h, i) => {
                    const bars = CANDLE_BARS[h.pattern] ?? 1;
                    const bull = h.bias === "bullish";
                    return (
                      <div key={i} className={`rounded-lg px-2.5 py-1.5 border text-xs ${bull ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={`font-semibold ${bull ? "text-emerald-700" : "text-red-600"}`}>{h.pattern}</span>
                          <span className="text-[10px] text-slate-400 font-medium">{bars}-bar</span>
                        </div>
                        <div className="text-[10px] text-slate-500 leading-tight truncate">{h.tip}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{h.date}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Compact stat strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {usdinr && (
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm flex items-center gap-2.5">
            <DollarSign size={13} className="text-blue-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-slate-400">USD / INR</div>
              <div className={`text-sm font-bold ${curChange < 0 ? "text-emerald-600" : curChange > 0 ? "text-red-500" : "text-slate-800"}`}>
                ₹{usdinr.close.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">{curChange >= 0 ? "+" : ""}{curChange.toFixed(3)}%</div>
            </div>
          </div>
        )}
        {india_vix && (
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm flex items-center gap-2.5">
            <Zap size={13} className="text-blue-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-slate-400">India VIX</div>
              <div className={`text-sm font-bold ${india_vix.close > 20 ? "text-red-500" : india_vix.close > 15 ? "text-amber-500" : "text-emerald-600"}`}>
                {india_vix.close.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">{vixChange >= 0 ? "+" : ""}{vixChange.toFixed(2)}%</div>
            </div>
          </div>
        )}
        {fii_latest && (
          <>
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm flex items-center gap-2.5">
              <TrendingUp size={13} className="text-blue-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400">FII Net</div>
                <div className={`text-sm font-bold ${fii_latest.fii_net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  ₹{(fii_latest.fii_net / 100).toFixed(0)} Cr
                </div>
                <div className="text-[10px] text-slate-400">{fii_latest.date}</div>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm flex items-center gap-2.5">
              <Activity size={13} className="text-blue-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400">DII Net</div>
                <div className={`text-sm font-bold ${fii_latest.dii_net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  ₹{(fii_latest.dii_net / 100).toFixed(0)} Cr
                </div>
                <div className="text-[10px] text-slate-400">{fii_latest.date}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Sector Performance grid ── */}
      <section>
        <SectionLabel icon={Activity}>Indian Sector Performance (1-day %)</SectionLabel>
        {sector_perf.length > 0 ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {sector_perf.map((s) => <SectorCard key={s.name} s={s} />)}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400">No sector data</div>
        )}
      </section>

      {/* ── FII / DII Net Flow Chart ── */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-blue-500" />
          <span className="text-sm font-semibold text-slate-700">FII / DII Net Flows (₹ Cr)</span>
          <div className="flex items-center gap-3 ml-auto text-[11px]">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block rounded-full" />FII Net</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block rounded-full" />DII Net</span>
          </div>
        </div>
        {fiiHistory.length > 0 ? (
          <FiiDiiChart rows={fiiHistory} />
        ) : (
          <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
            FII/DII data accumulates daily via scheduler
          </div>
        )}
        {fiiHistory.length > 0 && (
          <div className="text-[10px] text-slate-300 mt-1 text-right">{fiiHistory.length} trading days</div>
        )}
      </section>

      {/* ── News: India Corporate + Global Markets ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Newspaper size={13} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">India Corporate News</span>
            <span className="text-[10px] text-slate-400 ml-auto">deals · earnings · M&amp;A</span>
          </div>
          {indiaNews.length > 0 ? (
            <div>{indiaNews.slice(0, 7).map((item, i) => <NewsCard key={i} item={item} />)}</div>
          ) : (
            <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={13} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">Global Markets News</span>
            <span className="text-[10px] text-slate-400 ml-auto">US · Asia · Pacific</span>
          </div>
          {globalNews.length > 0 ? (
            <div>{globalNews.slice(0, 7).map((item, i) => <NewsCard key={i} item={item} />)}</div>
          ) : (
            <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
          )}
        </div>
      </section>

      {/* ── FII / DII latest detail (inline, compact) ── */}
      {fii_latest && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            { label: "FII Buy",  val: fii_latest.fii_buy,  up: true  },
            { label: "FII Sell", val: fii_latest.fii_sell, up: false },
            { label: "FII Net",  val: fii_latest.fii_net,  up: fii_latest.fii_net  >= 0 },
            { label: "DII Buy",  val: fii_latest.dii_buy,  up: true  },
            { label: "DII Sell", val: fii_latest.dii_sell, up: false },
            { label: "DII Net",  val: fii_latest.dii_net,  up: fii_latest.dii_net  >= 0 },
          ].map(({ label, val, up }) => (
            <div key={label} className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <span className="text-slate-400">{label}</span>
              <span className={`font-semibold ${up ? "text-emerald-600" : "text-red-500"}`}>₹{(val / 100).toFixed(0)} Cr</span>
            </div>
          ))}
          <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-300">{fii_latest.date}</div>
        </div>
      )}

      {/* ── US Markets + US Sectors ── */}
      <section className="bg-gradient-to-br from-blue-50 to-slate-50 border border-blue-100 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Globe size={15} className="text-blue-500" />
          <span className="text-sm font-bold text-blue-700 uppercase tracking-wide">US Markets</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {us_markets.map((m) => <MktTile key={m.name} {...m} />)}
        </div>
        {us_sectors.length > 0 && (
          <>
            <div className="text-[11px] font-bold text-blue-500 uppercase tracking-wide mb-2 ml-0.5">US Sectors (ETF %)</div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {us_sectors.map((s) => (
                <div key={s.name} className={`border rounded-lg p-2 transition-colors ${pctBg(s.change_pct)}`}>
                  <div className="text-[11px] font-semibold text-slate-600 truncate leading-tight">{s.name}</div>
                  <div className={`text-sm font-bold mt-0.5 ${s.change_pct >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Asia-Pacific + Europe ── */}
      {global_markets.length > 0 && (
        <section className="bg-gradient-to-br from-violet-50 to-slate-50 border border-violet-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={15} className="text-violet-500" />
            <span className="text-sm font-bold text-violet-700 uppercase tracking-wide">Asia-Pacific &amp; Europe</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {global_markets.map((m) => <MktTile key={m.name} {...m} />)}
          </div>
        </section>
      )}

      {/* ── Quick nav ── */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate("/screener")}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:shadow-md transition-all group">
          <SlidersHorizontal size={18} className="text-blue-500 mb-2" />
          <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">Screener</div>
          <div className="text-xs text-slate-400 mt-0.5">Filter stocks by fundamentals &amp; technicals</div>
        </button>
        <button onClick={() => navigate("/backtest")}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:shadow-md transition-all group">
          <FlaskConical size={18} className="text-blue-500 mb-2" />
          <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">Backtest</div>
          <div className="text-xs text-slate-400 mt-0.5">Test strategies on historical data</div>
        </button>
      </div>

    </div>
  );
}
