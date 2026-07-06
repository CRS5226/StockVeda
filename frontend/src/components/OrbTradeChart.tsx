import { useEffect, useRef } from "react";
import {
  createChart, type IChartApi, type ISeriesApi, type CandlestickData,
  type LineData, type SeriesMarker, type Time, type UTCTimestamp,
  ColorType, CrosshairMode, LineStyle,
} from "lightweight-charts";

export interface OrbBar { time: string; open: number; high: number; low: number; close: number }

interface Props {
  bars: OrbBar[];
  orHigh: number;
  orLow: number;
  direction: "long" | "short";
  entryTime: string;
  entryPrice: number;
  targetPrice: number;
  slPrice: number;
  exitTime: string;
  exitPrice: number;
  exitReason: string;
}

const BG = "#ffffff";
const GRID = "#f1f5f9";
const TEXT = "#64748b";

// Naive "YYYY-MM-DD HH:MM:SS" strings represent NSE-local wall-clock time (see
// backend/data_sync/sync_intraday.py) — parsed as browser-local time here too, so the
// displayed HH:MM always matches market hours regardless of the browser's timezone.
function toUnixSeconds(dt: string): UTCTimestamp {
  return Math.floor(new Date(dt.replace(" ", "T")).getTime() / 1000) as UTCTimestamp;
}

/**
 * Single trading day's intraday candlestick chart for one ORB trade — a dedicated,
 * lightweight-charts-based component (not the shared BacktestChart, which truncates
 * time to a date string and can't render multiple intraday bars per day).
 */
export default function OrbTradeChart({
  bars, orHigh, orLow, direction, entryTime, entryPrice, targetPrice, slPrice, exitTime, exitPrice, exitReason,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 300,
    });
    chartRef.current = chart;
    candleRef.current = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      borderVisible: false,
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !bars.length) return;
    const chart = chartRef.current;
    const candle = candleRef.current;

    candle.setData(bars.map((b) => ({
      time: toUnixSeconds(b.time), open: b.open, high: b.high, low: b.low, close: b.close,
    } as CandlestickData)));

    // Full-width reference lines — OR high/low apply for the whole day (the breakout
    // condition is checked against them all day, not just during the OR window).
    lineSeriesRef.current.forEach((s) => chart.removeSeries(s));
    lineSeriesRef.current = [];
    const startTime = toUnixSeconds(bars[0].time);
    const endTime = toUnixSeconds(bars[bars.length - 1].time);
    const addLine = (price: number, color: string, style: LineStyle = LineStyle.Dashed) => {
      const s = chart.addLineSeries({
        color, lineWidth: 1, lineStyle: style,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData([{ time: startTime, value: price }, { time: endTime, value: price }] as LineData[]);
      lineSeriesRef.current.push(s);
    };
    addLine(orHigh, "#f59e0b");
    addLine(orLow, "#f59e0b");
    addLine(targetPrice, "#22c55e");
    addLine(slPrice, "#ef4444");

    const markers: SeriesMarker<Time>[] = [
      {
        time: toUnixSeconds(entryTime), position: direction === "long" ? "belowBar" : "aboveBar",
        shape: direction === "long" ? "arrowUp" : "arrowDown",
        color: "#3b82f6", text: direction === "long" ? "B" : "S", size: 1,
      },
      {
        time: toUnixSeconds(exitTime), position: direction === "long" ? "aboveBar" : "belowBar",
        shape: exitReason === "target" ? "circle" : exitReason === "sl" ? "arrowDown" : "square",
        color: exitReason === "target" ? "#22c55e" : exitReason === "sl" ? "#ef4444" : "#94a3b8",
        text: exitReason === "target" ? "T" : exitReason === "sl" ? "SL" : exitReason === "eod" ? "EOD" : "?",
        size: 1,
      },
    ];
    candle.setMarkers(markers);
    chart.timeScale().fitContent();
  }, [bars, orHigh, orLow, direction, entryTime, entryPrice, targetPrice, slPrice, exitTime, exitPrice, exitReason]);

  return (
    <div>
      <div ref={containerRef} className="w-full" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 px-1 pt-1">
        <span><span className="inline-block w-2 h-0.5 bg-amber-500 align-middle mr-1" /> OR High/Low</span>
        <span><span className="inline-block w-2 h-0.5 bg-emerald-500 align-middle mr-1" /> Target</span>
        <span><span className="inline-block w-2 h-0.5 bg-red-500 align-middle mr-1" /> Stop Loss</span>
      </div>
    </div>
  );
}
