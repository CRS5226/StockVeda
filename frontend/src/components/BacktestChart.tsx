import { useEffect, useRef, useState } from "react";
import {
  createChart, type IChartApi, type ISeriesApi,
  type CandlestickData, type LineData, type Time,
  type SeriesMarker,
  ColorType, CrosshairMode, LineStyle,
} from "lightweight-charts";
import { BacktestTradeV2 } from "../lib/api";
import type { PatternHit } from "../lib/candlePatterns";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface AlgoTradeSet {
  label: string;
  color: string;   // primary hex color for this algo
  trades: BacktestTradeV2[];
  active: boolean; // active algo → larger markers + h-lines shown
}

export interface StrikeLine {
  entry_date: string;
  exit_date: string;
  call_strike: number;
  put_strike: number;
}

/** A shaded rectangle drawn directly on the candle chart, spanning a date range and a price band. */
export interface BoxZone {
  entry_date: string;
  exit_date: string;
  top: number;
  bottom: number;
  fill: string;    // rgba background
  border: string;  // hex/rgb border
}

interface Props {
  ohlcv: OhlcvRow[];
  symbol: string;
  /** Multi-stock mode: single set of trades */
  trades?: BacktestTradeV2[];
  /** Multi-algo mode: N algo trade sets overlaid */
  algoTrades?: AlgoTradeSet[];
  /** TA-Lib pattern hits from backend; pass [] to hide patterns */
  patternHits?: PatternHit[];
  /**
   * Entry/target/SL horizontal lines only make sense when trade prices share the
   * candle's price scale (cash/futures). Straddle/strangle trades track option
   * premium, not spot price, so pass false there to keep only the date-anchored
   * entry/exit markers.
   */
  hLines?: boolean;
  /** Call/put strike reference lines (straddle/strangle) — these ARE on the spot price scale. */
  strikeLines?: StrikeLine[];
  /** Shaded trade-zone rectangles (e.g. entry→target, entry→SL, or a straddle's strike band). */
  boxZones?: BoxZone[];
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

interface ZoneRect { left: number; top: number; width: number; height: number; fill: string; border: string }

export default function BacktestChart({
  ohlcv, trades = [], algoTrades, patternHits = [], hLines = true, strikeLines = [], boxZones = [],
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const tradeLines    = useRef<ISeriesApi<"Line">[]>([]);
  const loadedSymRef  = useRef<string>("");  // tracks which symbol's candles are loaded
  const boxZonesRef   = useRef<BoxZone[]>([]);
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);

  const recomputeZones = () => {
    const chart = chartRef.current, series = candleRef.current;
    if (!chart || !series) { setZoneRects([]); return; }
    const rects: ZoneRect[] = [];
    boxZonesRef.current.forEach((z) => {
      const x1 = chart.timeScale().timeToCoordinate(z.entry_date.slice(0, 10) as Time);
      const x2 = chart.timeScale().timeToCoordinate(z.exit_date.slice(0, 10) as Time);
      const y1 = series.priceToCoordinate(z.top);
      const y2 = series.priceToCoordinate(z.bottom);
      if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      rects.push({
        left: Math.min(x1, x2), width: Math.max(2, Math.abs(x2 - x1)),
        top: Math.min(y1, y2), height: Math.max(1, Math.abs(y2 - y1)),
        fill: z.fill, border: z.border,
      });
    });
    setZoneRects(rects);
  };

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

    chart.timeScale().subscribeVisibleTimeRangeChange(recomputeZones);

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth });
      recomputeZones();
    });
    ro.observe(containerRef.current);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(recomputeZones);
      ro.disconnect(); chart.remove(); chartRef.current = null;
    };
  }, []);

  // Keep the ref in sync so the stable subscribed callback always sees current zones.
  useEffect(() => {
    boxZonesRef.current = boxZones;
    recomputeZones();
  }, [boxZones]);

  // Update candle data — only fitContent() when the underlying symbol/data changes,
  // not when the caller swaps ohlcv references for the same stock data.
  useEffect(() => {
    if (!candleRef.current || !ohlcv.length) return;
    const identity = ohlcv[0]?.date + "|" + ohlcv[ohlcv.length - 1]?.date + "|" + ohlcv.length;
    const isNewData = loadedSymRef.current !== identity;
    candleRef.current.setData(
      ohlcv.map((r) => ({
        time: r.date.slice(0, 10) as Time,
        open: r.open, high: r.high, low: r.low, close: r.close,
      } as CandlestickData))
    );
    if (isNewData) {
      chartRef.current?.timeScale().fitContent();
      loadedSymRef.current = identity;
    }
    recomputeZones();
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

    const drawTrades = (
      tradeset: BacktestTradeV2[], color: string, active: boolean, multiAlgo: boolean
    ) => {
      // Active algo: size 2 (prominent). Inactive: size 1 (visible but dimmer).
      // Exit colors are per-algo so inactive markers are still identifiable by color.
      const markerSize = active ? 2 : 1;
      tradeset.forEach((t) => {
        const entryDate = t.entry_date.slice(0, 10);
        const exitDate  = t.exit_date.slice(0, 10);
        if (!dateSet.has(entryDate)) return;

        // H-lines only for the active algo to avoid clutter — and only when the
        // trade's price fields share the candle's scale (see hLines prop doc).
        if (active && hLines) {
          addHLine(entryDate, exitDate, t.entry_price,  color);
          addHLine(entryDate, exitDate, t.target_price, "#22c55e");
          addHLine(entryDate, exitDate, t.sl_price,     "#ef4444");
        }

        markers.push({
          time: entryDate as Time,
          position: "belowBar", shape: "arrowUp",
          color, text: "B", size: markerSize,
        });

        // In multi-algo mode use the algo's own color for exits so you can
        // tell algos apart. In multi-stock mode keep semantic green/red.
        const exitColor = multiAlgo
          ? color
          : t.exit_reason === "target" ? "#22c55e"
            : t.exit_reason === "sl" ? "#ef4444" : "#94a3b8";
        markers.push({
          time: exitDate as Time,
          position: "aboveBar",
          shape: t.exit_reason === "target" ? "circle" : "arrowDown",
          color: exitColor,
          text: t.exit_reason === "target" ? "T" : t.exit_reason === "sl" ? "SL" : "⏱",
          size: markerSize,
        });
      });
    };

    if (algoTrades && algoTrades.length > 0) {
      algoTrades.forEach((at) => drawTrades(at.trades, at.color, at.active, true));
    } else {
      drawTrades(trades, "#3b82f6", true, false);
    }

    // Straddle/strangle strike reference lines — these ARE on the candle's price scale.
    strikeLines.forEach((s) => {
      const entryDate = s.entry_date.slice(0, 10);
      const exitDate  = s.exit_date.slice(0, 10);
      if (!dateSet.has(entryDate)) return;
      addHLine(entryDate, exitDate, s.call_strike, "#f59e0b");
      if (s.put_strike !== s.call_strike) addHLine(entryDate, exitDate, s.put_strike, "#0ea5e9");
    });

    // TA-Lib candle pattern markers from backend
    patternHits.forEach((p) => {
      markers.push({
        time: p.date as Time,
        position: "belowBar", shape: "square",
        color: p.bias === "bullish" ? "#9333ea" : p.bias === "bearish" ? "#c026d3" : "#94a3b8",
        text: p.label, size: 1,
      });
    });

    markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));
    candleRef.current?.setMarkers(markers);
  }, [ohlcv, trades, algoTrades, patternHits, hLines, strikeLines]);

  const isMultiAlgo = algoTrades && algoTrades.length > 0;

  return (
    <div>
      <div className="relative">
        <div ref={containerRef} className="w-full" />
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {zoneRects.map((r, i) => (
            <div key={i} className="absolute rounded-sm"
              style={{
                left: r.left, top: r.top, width: r.width, height: r.height,
                backgroundColor: r.fill, border: `1px dashed ${r.border}`,
              }} />
          ))}
        </div>
      </div>
      <div className="flex gap-3 px-3 py-1 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex-wrap">
        {isMultiAlgo ? (
          <>
            {algoTrades!.map((at) => (
              <span key={at.label} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: at.color }} />
                <span style={{ color: at.color }} className="font-medium">{at.label}</span>
                <span className="text-slate-300 text-[9px]">↑B ●T ↓SL</span>
              </span>
            ))}
            <span className="text-slate-300 text-[9px] ml-1">· each algo in its own colour</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-500" />B Buy</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />T Target</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-400" />SL Stop</span>
          </>
        )}
        {patternHits.length > 0 && (
          <>
            <span className="text-slate-200">|</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-purple-500" />Bullish pattern</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-fuchsia-600" />Bearish pattern</span>
            <span className="text-slate-300">MS 3W E H P = bullish · ES 3B BE SS DC = bearish</span>
          </>
        )}
      </div>
    </div>
  );
}
