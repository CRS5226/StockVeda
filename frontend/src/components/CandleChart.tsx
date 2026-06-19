import { useEffect, useRef, useState } from "react";
import {
  createChart, type IChartApi, type ISeriesApi,
  type CandlestickData, type LineData, type HistogramData,
  type Time, ColorType, CrosshairMode,
} from "lightweight-charts";
import { Candle } from "../lib/api";

type OverlayKey = "sma_20" | "sma_50" | "sma_200" | "ema_20" | "bb_upper" | "bb_lower";
type OscType = "rsi" | "macd" | "stoch" | "willr" | "cci" | "adx";

const OVERLAYS: { key: OverlayKey; label: string; color: string }[] = [
  { key: "sma_20",   label: "SMA 20",  color: "#60a5fa" },
  { key: "sma_50",   label: "SMA 50",  color: "#f59e0b" },
  { key: "sma_200",  label: "SMA 200", color: "#a78bfa" },
  { key: "ema_20",   label: "EMA 20",  color: "#34d399" },
  { key: "bb_upper", label: "BB Upper",color: "#f87171" },
  { key: "bb_lower", label: "BB Lower",color: "#f87171" },
];

const OSC_OPTIONS: { key: OscType; label: string; height: number }[] = [
  { key: "rsi",   label: "RSI (14)",      height: 100 },
  { key: "macd",  label: "MACD",          height: 110 },
  { key: "stoch", label: "Stoch (14,3)",  height: 100 },
  { key: "willr", label: "Williams %R",   height: 100 },
  { key: "cci",   label: "CCI (20)",      height: 100 },
  { key: "adx",   label: "ADX (14)",      height: 100 },
];

const BG   = "#ffffff";
const GRID = "#f1f5f9";
const TEXT = "#64748b";

interface Props { candles: Candle[]; loading?: boolean }

function buildOscChart(
  el: HTMLDivElement,
  height: number,
  key: OscType,
  candles: Candle[],
): IChartApi {
  const chart = createChart(el, {
    layout: { background: { type: ColorType.Solid, color: BG }, textColor: TEXT },
    grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
    rightPriceScale: { borderColor: GRID },
    timeScale: { borderColor: GRID, visible: false },
    crosshair: { mode: CrosshairMode.Normal },
    width: el.clientWidth,
    height,
  });

  const hline = (value: number, color = "#94a3b8") => {
    const s = chart.addLineSeries({ color, lineWidth: 1, lineStyle: 2, priceLineVisible: false });
    s.setData(candles.filter(c => c.close != null).map(c => ({ time: c.date as Time, value } as LineData)));
  };

  if (key === "rsi") {
    const s = chart.addLineSeries({ color: "#c084fc", lineWidth: 2, priceLineVisible: false });
    s.setData(candles.filter(c => c.rsi_14 != null).map(c => ({ time: c.date as Time, value: c.rsi_14! } as LineData)));
    hline(70, "#ef4444"); hline(50, "#94a3b8"); hline(30, "#22c55e");

  } else if (key === "macd") {
    const hist = chart.addHistogramSeries({ priceLineVisible: false });
    hist.setData(candles.filter(c => c.macd_hist != null).map(c => ({
      time: c.date as Time, value: c.macd_hist!,
      color: (c.macd_hist ?? 0) >= 0 ? "#22c55e" : "#ef4444",
    } as HistogramData)));
    const ml = chart.addLineSeries({ color: "#60a5fa", lineWidth: 2, priceLineVisible: false });
    ml.setData(candles.filter(c => c.macd != null).map(c => ({ time: c.date as Time, value: c.macd! } as LineData)));
    const sl = chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, priceLineVisible: false });
    sl.setData(candles.filter(c => c.macd_signal != null).map(c => ({ time: c.date as Time, value: c.macd_signal! } as LineData)));

  } else if (key === "stoch") {
    const k = chart.addLineSeries({ color: "#34d399", lineWidth: 2, priceLineVisible: false });
    k.setData(candles.filter(c => c.stoch_k != null).map(c => ({ time: c.date as Time, value: c.stoch_k! } as LineData)));
    const d = chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, priceLineVisible: false });
    d.setData(candles.filter(c => c.stoch_d != null).map(c => ({ time: c.date as Time, value: c.stoch_d! } as LineData)));
    hline(80, "#ef4444"); hline(20, "#22c55e");

  } else if (key === "willr") {
    const s = chart.addLineSeries({ color: "#f87171", lineWidth: 2, priceLineVisible: false });
    s.setData(candles.filter(c => c.willr != null).map(c => ({ time: c.date as Time, value: c.willr! } as LineData)));
    hline(-20, "#ef4444"); hline(-80, "#22c55e");

  } else if (key === "cci") {
    const s = chart.addLineSeries({ color: "#2dd4bf", lineWidth: 2, priceLineVisible: false });
    s.setData(candles.filter(c => c.cci != null).map(c => ({ time: c.date as Time, value: c.cci! } as LineData)));
    hline(100, "#ef4444"); hline(0, "#94a3b8"); hline(-100, "#22c55e");

  } else if (key === "adx") {
    const adxLine = chart.addLineSeries({ color: "#94a3b8", lineWidth: 2, priceLineVisible: false });
    adxLine.setData(candles.filter(c => c.adx != null).map(c => ({ time: c.date as Time, value: c.adx! } as LineData)));
    const posLine = chart.addLineSeries({ color: "#22c55e", lineWidth: 1, priceLineVisible: false });
    posLine.setData(candles.filter(c => c.adx_pos != null).map(c => ({ time: c.date as Time, value: c.adx_pos! } as LineData)));
    const negLine = chart.addLineSeries({ color: "#ef4444", lineWidth: 1, priceLineVisible: false });
    negLine.setData(candles.filter(c => c.adx_neg != null).map(c => ({ time: c.date as Time, value: c.adx_neg! } as LineData)));
    hline(25, "#64748b");
  }

  return chart;
}

export default function CandleChart({ candles, loading }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const candleRef      = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef         = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeries  = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const oscDivMap      = useRef<Map<OscType, HTMLDivElement | null>>(new Map());
  const oscChartMap    = useRef<Map<OscType, IChartApi>>(new Map());
  const oscRoMap       = useRef<Map<OscType, ResizeObserver>>(new Map());
  const oscRangeSubs   = useRef<Array<() => void>>([]);

  const [activeOverlays, setActiveOverlays] = useState<Set<OverlayKey>>(
    new Set(["sma_20", "sma_50"])
  );
  const [activeOsc, setActiveOsc] = useState<Set<OscType>>(new Set(["rsi"]));

  // Stable div ref callbacks per oscillator (created once)
  const oscRefCallbacks = useRef(
    Object.fromEntries(
      OSC_OPTIONS.map(o => [
        o.key,
        (el: HTMLDivElement | null) => { oscDivMap.current.set(o.key, el); },
      ])
    ) as Record<OscType, (el: HTMLDivElement | null) => void>
  );

  // ── Init main chart (once) ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 380,
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
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volRef.current = vs;

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  // ── Update candle + volume data ─────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !volRef.current || !candles.length) return;
    candleRef.current.setData(
      candles.map(c => ({ time: c.date as unknown as Time, open: c.open, high: c.high, low: c.low, close: c.close } as CandlestickData))
    );
    volRef.current.setData(
      candles.map(c => ({ time: c.date as unknown as Time, value: c.volume, color: c.close >= c.open ? "#166534" : "#7f1d1d" } as HistogramData))
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // ── Overlays ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current || !candles.length) return;
    overlaySeries.current.forEach(s => chartRef.current!.removeSeries(s));
    overlaySeries.current.clear();
    OVERLAYS.forEach(({ key, color }) => {
      if (!activeOverlays.has(key)) return;
      const s = chartRef.current!.addLineSeries({ color, lineWidth: 1, priceLineVisible: false });
      s.setData(
        candles.filter(c => c[key] != null).map(c => ({ time: c.date as unknown as Time, value: c[key] as number } as LineData))
      );
      overlaySeries.current.set(key, s);
    });
  }, [candles, activeOverlays]);

  // ── Oscillator panes ────────────────────────────────────────────────────
  useEffect(() => {
    // Unsub old range sync handlers
    for (const unsub of oscRangeSubs.current) unsub();
    oscRangeSubs.current = [];

    // Disconnect old resize observers
    for (const ro of oscRoMap.current.values()) ro.disconnect();
    oscRoMap.current.clear();

    // Destroy all existing osc charts
    for (const chart of oscChartMap.current.values()) chart.remove();
    oscChartMap.current.clear();

    if (!candles.length) return;

    for (const osc of OSC_OPTIONS) {
      if (!activeOsc.has(osc.key)) continue;
      const div = oscDivMap.current.get(osc.key);
      if (!div) continue;

      const chart = buildOscChart(div, osc.height, osc.key, candles);
      oscChartMap.current.set(osc.key, chart);

      // Sync time scale with main chart
      if (chartRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (range: any) => {
          if (range) chart.timeScale().setVisibleLogicalRange(range);
        };
        chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handler);
        oscRangeSubs.current.push(
          () => chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
        );
      }

      const ro = new ResizeObserver(() => {
        if (div) chart.applyOptions({ width: div.clientWidth });
      });
      ro.observe(div);
      oscRoMap.current.set(osc.key, ro);
    }

    return () => {
      for (const unsub of oscRangeSubs.current) unsub();
      oscRangeSubs.current = [];
      for (const ro of oscRoMap.current.values()) ro.disconnect();
      oscRoMap.current.clear();
      for (const chart of oscChartMap.current.values()) chart.remove();
      oscChartMap.current.clear();
    };
  }, [candles, activeOsc]);

  const toggleOverlay = (key: OverlayKey) =>
    setActiveOverlays(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const toggleOsc = (key: OscType) =>
    setActiveOsc(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  return (
    <div className="flex flex-col gap-0">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Overlays</span>
          {OVERLAYS.map(({ key, label, color }) => (
            <label key={key} className="flex items-center gap-1 cursor-pointer text-xs select-none">
              <input type="checkbox" checked={activeOverlays.has(key)} onChange={() => toggleOverlay(key)}
                className="accent-blue-500 w-3 h-3" />
              <span style={{ color }}>{label}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Oscillators</span>
          {OSC_OPTIONS.map(osc => (
            <label key={osc.key} className="flex items-center gap-1 cursor-pointer text-xs select-none">
              <input type="checkbox" checked={activeOsc.has(osc.key)} onChange={() => toggleOsc(osc.key)}
                className="accent-purple-500 w-3 h-3" />
              <span className={activeOsc.has(osc.key) ? "text-slate-700" : "text-slate-400"}>
                {osc.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Main candle chart */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 text-slate-400 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
              Loading…
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full" />
      </div>

      {/* Oscillator panes — one per active oscillator */}
      {OSC_OPTIONS.filter(o => activeOsc.has(o.key)).map(osc => (
        <div key={osc.key} className="border-t border-slate-100">
          <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5">
            <span className="text-xs text-slate-400 font-medium">{osc.label}</span>
          </div>
          <div ref={oscRefCallbacks.current[osc.key]} className="w-full" />
        </div>
      ))}
    </div>
  );
}
