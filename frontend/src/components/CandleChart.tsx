import { useEffect, useRef, useState } from "react";
import {
  createChart, type IChartApi, type ISeriesApi,
  type CandlestickData, type LineData, type HistogramData,
  type Time, ColorType, CrosshairMode,
} from "lightweight-charts";
import { Candle } from "../lib/api";

interface Props {
  candles: Candle[];
  loading?: boolean;
}

const OVERLAYS = [
  { key: "sma_20",  label: "SMA 20",  color: "#60a5fa" },
  { key: "sma_50",  label: "SMA 50",  color: "#f59e0b" },
  { key: "sma_200", label: "SMA 200", color: "#a78bfa" },
  { key: "ema_20",  label: "EMA 20",  color: "#34d399" },
  { key: "bb_upper",label: "BB Upper",color: "#f87171" },
  { key: "bb_lower",label: "BB Lower",color: "#f87171" },
] as const;

type OverlayKey = typeof OVERLAYS[number]["key"];
type Oscillator = "rsi" | "macd" | "none";

function toTime(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000) as number;
}

export default function CandleChart({ candles, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef       = useRef<ISeriesApi<"Histogram"> | null>(null);
  const oscChart     = useRef<IChartApi | null>(null);
  const oscSeries    = useRef<ISeriesApi<"Line"> | null>(null);
  const oscSeries2   = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeries = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const [activeOverlays, setActiveOverlays] = useState<Set<OverlayKey>>(
    new Set(["sma_20", "sma_50"])
  );
  const [oscillator, setOscillator] = useState<Oscillator>("rsi");

  const CHART_BG  = "#0a0a0f";
  const GRID      = "#1f2937";
  const TEXT      = "#9ca3af";

  // Init main chart
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: TEXT },
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
      color: "#3b82f6",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volRef.current = vs;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  // Update candle + volume data
  useEffect(() => {
    if (!candleRef.current || !volRef.current || !candles.length) return;
    const cdata: CandlestickData[] = candles.map((c) => ({
      time: c.date as unknown as Time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const vdata: HistogramData[] = candles.map((c) => ({
      time: c.date as unknown as Time,
      value: c.volume,
      color: c.close >= c.open ? "#166534" : "#7f1d1d",
    }));
    candleRef.current.setData(cdata);
    volRef.current.setData(vdata);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Overlays
  useEffect(() => {
    if (!chartRef.current || !candles.length) return;
    // Remove old overlay series
    overlaySeries.current.forEach((s) => chartRef.current!.removeSeries(s));
    overlaySeries.current.clear();

    OVERLAYS.forEach(({ key, color }) => {
      if (!activeOverlays.has(key)) return;
      const series = chartRef.current!.addLineSeries({ color, lineWidth: 1, priceLineVisible: false });
      const data: LineData[] = candles
        .filter((c) => c[key] != null)
        .map((c) => ({ time: c.date as unknown as Time, value: c[key] as number }));
      series.setData(data);
      overlaySeries.current.set(key, series);
    });
  }, [candles, activeOverlays]);

  // Oscillator chart
  const oscContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!oscContainerRef.current) return;
    if (oscChart.current) { oscChart.current.remove(); oscChart.current = null; }
    if (oscillator === "none" || !candles.length) return;

    const chart = createChart(oscContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, visible: false },
      width: oscContainerRef.current.clientWidth,
      height: 120,
    });
    oscChart.current = chart;

    if (oscillator === "rsi") {
      const s = chart.addLineSeries({ color: "#c084fc", lineWidth: 1 });
      s.setData(candles.filter((c) => c.rsi_14 != null).map((c) => ({
        time: c.date as unknown as Time, value: c.rsi_14!,
      })));
      oscSeries.current = s;
      // Reference lines
      chart.addLineSeries({ color: "#4b5563", lineWidth: 1, lineStyle: 2 })
        .setData(candles.map((c) => ({ time: c.date as unknown as Time, value: 70 })));
      chart.addLineSeries({ color: "#4b5563", lineWidth: 1, lineStyle: 2 })
        .setData(candles.map((c) => ({ time: c.date as unknown as Time, value: 30 })));
    } else {
      const hist = chart.addHistogramSeries({ color: "#6b7280" });
      hist.setData(candles.filter((c) => c.macd_hist != null).map((c) => ({
        time: c.date as unknown as Time, value: c.macd_hist!,
        color: (c.macd_hist ?? 0) >= 0 ? "#166534" : "#7f1d1d",
      })));
      const macdLine = chart.addLineSeries({ color: "#60a5fa", lineWidth: 1 });
      macdLine.setData(candles.filter((c) => c.macd != null).map((c) => ({
        time: c.date as unknown as Time, value: c.macd!,
      })));
      const sigLine = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1 });
      sigLine.setData(candles.filter((c) => c.macd_signal != null).map((c) => ({
        time: c.date as unknown as Time, value: c.macd_signal!,
      })));
      oscSeries2.current = hist;
    }

    // Sync time scales
    if (chartRef.current && oscChart.current) {
      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) oscChart.current?.timeScale().setVisibleLogicalRange(range);
      });
    }

    const ro = new ResizeObserver(() => {
      if (oscContainerRef.current)
        chart.applyOptions({ width: oscContainerRef.current.clientWidth });
    });
    ro.observe(oscContainerRef.current);
    return () => { ro.disconnect(); };
  }, [candles, oscillator]);

  const toggleOverlay = (key: OverlayKey) =>
    setActiveOverlays((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-0">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 px-2 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-500 font-medium">Overlays:</span>
        {OVERLAYS.map(({ key, label, color }) => (
          <label key={key} className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={activeOverlays.has(key)}
              onChange={() => toggleOverlay(key)}
              className="accent-blue-500"
            />
            <span style={{ color }}>{label}</span>
          </label>
        ))}
        <span className="ml-4 text-xs text-gray-500 font-medium">Oscillator:</span>
        {(["rsi", "macd", "none"] as Oscillator[]).map((o) => (
          <button
            key={o}
            onClick={() => setOscillator(o)}
            className={`text-xs px-2 py-0.5 rounded ${oscillator === o ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-100"}`}
          >
            {o.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Main chart */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/70 z-10 text-gray-400 text-sm">
            Loading…
          </div>
        )}
        <div ref={containerRef} className="w-full" />
      </div>

      {/* Oscillator pane */}
      {oscillator !== "none" && (
        <div className="border-t border-gray-800">
          <div className="text-xs text-gray-500 px-2 pt-1">
            {oscillator === "rsi" ? "RSI (14)" : "MACD (12/26/9)"}
          </div>
          <div ref={oscContainerRef} className="w-full" />
        </div>
      )}
    </div>
  );
}
