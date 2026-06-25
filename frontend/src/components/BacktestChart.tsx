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

export interface AlgoTradeSet {
  label: string;
  color: string;   // primary hex color for this algo
  trades: BacktestTradeV2[];
  active: boolean; // active algo → larger markers + h-lines shown
}

interface Props {
  ohlcv: OhlcvRow[];
  symbol: string;
  /** Multi-stock mode: single set of trades */
  trades?: BacktestTradeV2[];
  /** Multi-algo mode: N algo trade sets overlaid */
  algoTrades?: AlgoTradeSet[];
  showPatterns?: boolean;
}

const BG   = "#ffffff";
const GRID = "#f1f5f9";
const TEXT = "#64748b";

function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function BacktestChart({
  ohlcv, trades = [], algoTrades, showPatterns = true,
}: Props) {
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

  // Draw trade markers and h-lines
  useEffect(() => {
    if (!chartRef.current || !ohlcv.length) return;

    // Remove old lines
    tradeLines.current.forEach((s) => chartRef.current?.removeSeries(s));
    tradeLines.current = [];

    const allDates = ohlcv.map((r) => r.date.slice(0, 10));
    const dateSet  = new Set(allDates);

    const addHLine = (from: string, to: string, price: number, color: string) => {
      if (!chartRef.current) return;
      const fromIdx = allDates.indexOf(from);
      const toIdx   = allDates.findIndex((d) => d >= to);
      const endIdx  = toIdx >= 0 ? Math.min(toIdx + 1, allDates.length - 1) : allDates.length - 1;
      const slice   = allDates.slice(Math.max(0, fromIdx), endIdx + 1);
      if (!slice.length) return;
      const s = chartRef.current.addLineSeries({
        color, lineWidth: 1, lineStyle: LineStyle.Dashed,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(slice.map((d) => ({ time: d as Time, value: price } as LineData)));
      tradeLines.current.push(s);
    };

    const markers: SeriesMarker<Time>[] = [];

    const drawTrades = (tradeset: BacktestTradeV2[], color: string, active: boolean) => {
      const markerSize = active ? 2 : 1;
      tradeset.forEach((t) => {
        const entryDate = t.entry_date.slice(0, 10);
        const exitDate  = t.exit_date.slice(0, 10);
        if (!dateSet.has(entryDate)) return;

        // H-lines only for active algo (avoid visual noise in multi-algo mode)
        if (active) {
          addHLine(entryDate, exitDate, t.entry_price,  color);
          addHLine(entryDate, exitDate, t.target_price, "#22c55e");
          addHLine(entryDate, exitDate, t.sl_price,     "#ef4444");
        }

        markers.push({
          time: entryDate as Time,
          position: "belowBar", shape: "arrowUp",
          color, text: "B", size: markerSize,
        });

        const exitColor = t.exit_reason === "target" ? "#22c55e"
          : t.exit_reason === "sl" ? "#ef4444" : "#94a3b8";
        markers.push({
          time: exitDate as Time,
          position: "aboveBar",
          shape: t.exit_reason === "target" ? "circle" : "arrowDown",
          color: exitColor, text: t.exit_reason === "target" ? "T" : t.exit_reason === "sl" ? "SL" : "⏱",
          size: markerSize,
        });
      });
    };

    if (algoTrades && algoTrades.length > 0) {
      // Multi-algo mode: draw each algo with its own color, active one gets h-lines + larger markers
      algoTrades.forEach((at) => drawTrades(at.trades, at.color, at.active));
    } else {
      // Multi-stock mode: single color scheme
      drawTrades(trades, "#3b82f6", true);
    }

    // Candle pattern markers (only when enabled)
    if (showPatterns) {
      detectPatterns(ohlcv).forEach((p) => {
        const bullish = p.bias === "bullish";
        markers.push({
          time: p.date as Time,
          position: "belowBar", shape: "square",
          color: bullish ? "#9333ea" : "#c026d3",
          text: p.label, size: 1,
        });
      });
    }

    markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));
    candleRef.current?.setMarkers(markers);
  }, [ohlcv, trades, algoTrades, showPatterns]);

  const isMultiAlgo = algoTrades && algoTrades.length > 0;

  return (
    <div>
      <div ref={containerRef} className="w-full" />
      <div className="flex gap-3 px-3 py-1 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex-wrap">
        {isMultiAlgo ? (
          algoTrades!.map((at) => (
            <span key={at.label} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: at.color }} />
              {at.label}
            </span>
          ))
        ) : (
          <>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-500" />B Buy</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />T Target</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-400" />SL Stop</span>
          </>
        )}
        {showPatterns && (
          <>
            <span className="text-slate-200">|</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-purple-500" />Bullish patterns</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-fuchsia-600" />Bearish patterns</span>
            <span className="text-slate-300">H E P MS = bullish · S BE ES = bearish · D I = neutral</span>
          </>
        )}
      </div>
    </div>
  );
}
