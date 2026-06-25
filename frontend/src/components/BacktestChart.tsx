import { useEffect, useRef } from "react";
import {
  createChart, type IChartApi, type ISeriesApi,
  type CandlestickData, type LineData, type Time,
  type SeriesMarker,
  ColorType, CrosshairMode, LineStyle,
} from "lightweight-charts";
import { BacktestTradeV2 } from "../lib/api";
import { detectPatterns } from "../lib/candlePatterns";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

interface Props {
  ohlcv: OhlcvRow[];
  trades: BacktestTradeV2[];
  symbol: string;
}

const BG   = "#ffffff";
const GRID = "#f1f5f9";
const TEXT = "#64748b";

export default function BacktestChart({ ohlcv, trades }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const tradeLines   = useRef<ISeriesApi<"Line">[]>([]);

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 340,
    });
    chartRef.current = chart;

    const cs = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      borderVisible: false,
    });
    candleRef.current = cs;

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!candleRef.current || !ohlcv.length) return;
    candleRef.current.setData(
      ohlcv.map((r) => ({
        time: r.date.slice(0, 10) as Time,
        open: r.open, high: r.high, low: r.low, close: r.close,
      } as CandlestickData))
    );
    chartRef.current?.timeScale().fitContent();
  }, [ohlcv]);

  // Draw trade lines — entry (blue), target (green), SL (red) per trade
  useEffect(() => {
    if (!chartRef.current || !ohlcv.length) return;

    // Remove old trade lines
    tradeLines.current.forEach((s) => chartRef.current?.removeSeries(s));
    tradeLines.current = [];

    if (!trades.length) return;

    // Build a date→index map for slicing
    const dateSet = new Set(ohlcv.map((r) => r.date.slice(0, 10)));
    const allDates = ohlcv.map((r) => r.date.slice(0, 10));

    const addHLine = (
      from: string, to: string, price: number, color: string
    ) => {
      if (!chartRef.current) return;
      const fromIdx = allDates.indexOf(from);
      const toIdx   = allDates.findIndex((d) => d >= to);
      const endIdx  = toIdx >= 0 ? Math.min(toIdx + 1, allDates.length - 1) : allDates.length - 1;
      const slice   = allDates.slice(Math.max(0, fromIdx), endIdx + 1);
      if (!slice.length) return;

      const s = chartRef.current.addLineSeries({
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(slice.map((d) => ({ time: d as Time, value: price } as LineData)));
      tradeLines.current.push(s);
    };

    trades.forEach((t) => {
      const entryDate = t.entry_date.slice(0, 10);
      const exitDate  = t.exit_date.slice(0, 10);
      if (!dateSet.has(entryDate)) return;
      addHLine(entryDate, exitDate, t.entry_price,  "#3b82f6"); // blue — entry
      addHLine(entryDate, exitDate, t.target_price, "#22c55e"); // green — target
      addHLine(entryDate, exitDate, t.sl_price,     "#ef4444"); // red — SL
    });

    // Entry/exit markers sorted by time (required by lightweight-charts)
    const markers: SeriesMarker<Time>[] = [];
    trades.forEach((t) => {
      markers.push({
        time: t.entry_date.slice(0, 10) as Time,
        position: "belowBar",
        shape: "arrowUp",
        color: "#3b82f6",
        text: "B",
        size: 1,
      });
      const exitColor = t.exit_reason === "target" ? "#22c55e"
        : t.exit_reason === "sl" ? "#ef4444" : "#94a3b8";
      const exitText = t.exit_reason === "target" ? "T"
        : t.exit_reason === "sl" ? "SL" : "⏱";
      markers.push({
        time: t.exit_date.slice(0, 10) as Time,
        position: "aboveBar",
        shape: t.exit_reason === "target" ? "circle" : "arrowDown",
        color: exitColor,
        text: exitText,
        size: 1,
      });
    });

    // Candle pattern markers — purple squares below bars
    detectPatterns(ohlcv).forEach((p) => {
      markers.push({
        time: p.date as Time,
        position: "belowBar",
        shape: "square",
        color: "#9333ea",
        text: p.label,
        size: 1,
      });
    });

    markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));
    candleRef.current?.setMarkers(markers);
  }, [ohlcv, trades]);

  return (
    <div>
      <div ref={containerRef} className="w-full" />
      <div className="flex gap-4 px-3 py-1 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex-wrap">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-500" />B Buy entry</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />T Target hit</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-400" />SL Stop-loss</span>
        <span className="text-slate-200">|</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-purple-500" />H Hammer</span>
        <span className="flex items-center gap-1 text-slate-400">E Engulfing</span>
        <span className="flex items-center gap-1 text-slate-400">I Inside Bar</span>
        <span className="flex items-center gap-1 text-slate-400">P Pin Bar</span>
      </div>
    </div>
  );
}
