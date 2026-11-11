import { useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, CrosshairMode,
  type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, type Time, type MouseEventParams,
} from "lightweight-charts";
import type { Candle } from "../lib/api";
import { barKey, toChartTime } from "../lib/barTime";

import { PALETTES, type ChartPalette, type ChartTheme } from "../lib/chartTheme";

const UP = "#22c55e";
const DOWN = "#ef4444";

interface Readout { open: number; high: number; low: number; close: number; volume?: number }

/** Sorted, de-duplicated chart rows; lightweight-charts needs strictly ascending unique times. */
function toSeriesData(bars: Candle[]): { candles: CandlestickData[]; volumes: HistogramData[] } {
  const byTime = new Map<number | string, Candle>();
  for (const b of bars) byTime.set(String(toChartTime(barKey(b.date))), b);
  const rows = [...byTime.values()]
    .map((b) => ({ b, time: toChartTime(barKey(b.date)) as Time }))
    .sort((a, z) => (a.time < z.time ? -1 : a.time > z.time ? 1 : 0));
  return {
    candles: rows.map(({ b, time }) => ({ time, open: b.open, high: b.high, low: b.low, close: b.close })),
    volumes: rows.map(({ b, time }) => ({
      time, value: b.volume ?? 0, color: b.close >= b.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
    })),
  };
}

const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVol = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(2)}L` : n.toLocaleString("en-IN");

/** Chart options that depend on the theme; used both at creation and when the theme changes. */
function themeOptions(p: ChartPalette) {
  return {
    layout: { background: { type: ColorType.Solid, color: p.background }, textColor: p.text },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    crosshair: {
      vertLine: { color: p.crosshair, labelBackgroundColor: p.border },
      horzLine: { color: p.crosshair, labelBackgroundColor: p.border },
    },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border },
  };
}

/** Candlestick + volume chart that fills its parent (the parent must have a definite height). */
export default function ChartCanvas({ bars, theme = "light" }: { bars: Candle[]; theme?: ChartTheme }) {
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastRef = useRef<Readout | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Create the chart once. Size comes from the container, so it follows window resizes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const initial = themeOptions(PALETTES[themeRef.current]);
    const chart = createChart(el, {
      ...initial,
      crosshair: { mode: CrosshairMode.Normal, ...initial.crosshair },
      timeScale: { ...initial.timeScale, timeVisible: true, rightOffset: 6 },
      width: el.clientWidth,
      height: el.clientHeight,
    });
    const candles = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
    });
    const volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;

    const onMove = (p: MouseEventParams) => {
      const c = p.seriesData.get(candles) as CandlestickData | undefined;
      if (!c || !("open" in c)) { setReadout(lastRef.current); return; }
      const v = p.seriesData.get(volume) as HistogramData | undefined;
      setReadout({ open: c.open, high: c.high, low: c.low, close: c.close, volume: v?.value });
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = candleRef.current = volumeRef.current = null;
    };
  }, []);

  // Recolour the live chart when the theme changes (no rebuild, so zoom and scroll are kept).
  useEffect(() => {
    chartRef.current?.applyOptions(themeOptions(PALETTES[theme]));
  }, [theme]);

  // Push new data and frame it.
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current) return;
    const { candles, volumes } = toSeriesData(bars);
    candleRef.current.setData(candles);
    volumeRef.current.setData(volumes);
    chartRef.current?.timeScale().fitContent();
    const last = bars.length ? bars[bars.length - 1] : null;
    lastRef.current = last ? { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume } : null;
    setReadout(lastRef.current);
  }, [bars]);

  const up = readout ? readout.close >= readout.open : true;
  const color = up ? "text-emerald-500" : "text-red-500";
  const dark = theme === "dark";

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />
      {readout && (
        <div className={`absolute top-2 left-3 z-10 flex flex-wrap gap-x-3 text-xs font-medium pointer-events-none select-none rounded px-1.5 py-0.5 ${dark ? "bg-[#131722]/80" : "bg-white/80"}`}>
          <span className="text-slate-500">O <span className={color}>{fmt(readout.open)}</span></span>
          <span className="text-slate-500">H <span className={color}>{fmt(readout.high)}</span></span>
          <span className="text-slate-500">L <span className={color}>{fmt(readout.low)}</span></span>
          <span className="text-slate-500">C <span className={color}>{fmt(readout.close)}</span></span>
          {readout.volume !== undefined && <span className="text-slate-500">Vol <span className={color}>{fmtVol(readout.volume)}</span></span>}
        </div>
      )}
    </div>
  );
}
