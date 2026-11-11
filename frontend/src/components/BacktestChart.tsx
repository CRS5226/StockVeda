import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, type IChartApi, type ISeriesApi,
  type CandlestickData, type LineData, type Time,
  type SeriesMarker,
  ColorType, CrosshairMode, LineStyle,
} from "lightweight-charts";
import { BacktestTradeV2 } from "../lib/api";
import type { PatternHit } from "../lib/candlePatterns";
import { mapStructure } from "../lib/smcStructure";
import { detectStructureFvgs } from "../lib/smcFvg";
import { detectAdvancedOrderBlocks, detectStructureOrderBlocks } from "../lib/smcOrderBlocks";
import { detectLiquidityPools, detectLiquiditySweeps } from "../lib/smcLiquidity";
import { detectSmcBlocks } from "../lib/smcBlocks";
import { barKey, toChartTime } from "../lib/barTime";

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

/** Which SMC overlays to draw on the chart (issue #79). */
export interface SmcToggles {
  bos: boolean;
  choch: boolean;
  idm: boolean;          // inducement
  points: boolean;       // confirmed HH / HL / LH / LL
  orderBlocks: boolean;       // structure-aware blocks with an FVG on the far side
  advancedBlocks: boolean;    // run of same-colour candles, no FVG needed
  fourCandle: boolean;        // only keep blocks the 4th candle after them confirms
  showMitigated: boolean;     // keep fully mitigated / invalidated blocks on the chart
  fvg: boolean;               // every structure FVG, whatever its type
  pfg: boolean;               // perfect FVGs only (also when "fvg" is off)
  bfg: boolean;
  rfg: boolean;
  ifvg: boolean;              // inverse FVGs: a gap price closed through
  liquidity: boolean;    // EQH/EQL pools + sweeps
  breaker: boolean;
  reclaimed: boolean;
  mitigation: boolean;
}

export const NO_SMC: SmcToggles = {
  bos: false, choch: false, idm: false, points: false,
  orderBlocks: false, advancedBlocks: false, fourCandle: false, showMitigated: false, fvg: false, pfg: false, bfg: false, rfg: false, ifvg: false, liquidity: false,
  breaker: false, reclaimed: false, mitigation: false,
};

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
  /** SMC (Smart Money Concepts) overlays to draw; omit for none. */
  smc?: SmcToggles;
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

interface LineLabel { fromDate: string; toDate: string; level: number; text: string; color: string }
interface LabelPos { left: number; top: number; text: string; color: string }
interface ZoneRect { left: number; top: number; width: number; height: number; fill: string; border: string }

// Stable empty-array references — an inline `= []` default parameter creates a NEW
// array every render, which fed into a useEffect([boxZones]) that calls setZoneRects()
// (a state update triggering a re-render, which recreates the default, re-firing the
// effect forever) — a genuine infinite render loop whenever a caller omits boxZones.
const EMPTY_TRADES: BacktestTradeV2[] = [];
const EMPTY_PATTERNS: PatternHit[] = [];
const EMPTY_STRIKE_LINES: StrikeLine[] = [];
const EMPTY_BOX_ZONES: BoxZone[] = [];

export default function BacktestChart({
  ohlcv, trades = EMPTY_TRADES, algoTrades, patternHits = EMPTY_PATTERNS, hLines = true,
  strikeLines = EMPTY_STRIKE_LINES, boxZones = EMPTY_BOX_ZONES, smc = NO_SMC,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const tradeLines    = useRef<ISeriesApi<"Line">[]>([]);
  const loadedSymRef  = useRef<string>("");  // tracks which symbol's candles are loaded
  const boxZonesRef   = useRef<BoxZone[]>([]);
  const pendingTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountedRef    = useRef(true);
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);
  // Text labels pinned to the middle of a horizontal level (BOS / ChoCH), drawn as HTML
  // because chart markers can only attach to a candle, not to the centre of a line.
  const lineLabelsRef = useRef<LineLabel[]>([]);
  const [labelPos, setLabelPos] = useState<LabelPos[]>([]);
  // SMC overlays (issue #79) are driven by the SMC tab; every other chart usage leaves them off.
  const { bos: bosOn, choch: chochOn, idm: idmOn, points: pointsOn,
          orderBlocks: obOn, advancedBlocks: advOn, fourCandle: fourOn, showMitigated: showMitOn,
          fvg: fvgOn, pfg: pfgOn, bfg: bfgOn, rfg: rfgOn, ifvg: ifvgOn, liquidity: liqOn,
          breaker: brkOn, reclaimed: rclOn, mitigation: mitOn } = smc;

  // Order blocks follow the structure map, so they are computed once per data/toggle change and
  // shared by the zone boxes and the CE / mean lines.
  const orderBlocks = useMemo(() => {
    if (!obOn) return [];
    return detectStructureOrderBlocks(ohlcv)
      .filter((b) => showMitOn || b.status !== "full")
      .filter((b) => !fourOn || b.followThrough !== false);
  }, [ohlcv, obOn, fourOn, showMitOn]);
  const fvgs = useMemo(() => {
    const typeOn = { FVG: fvgOn, PFG: fvgOn || pfgOn, BFG: fvgOn || bfgOn, RFG: fvgOn || rfgOn, IFVG: ifvgOn };
    if (!Object.values(typeOn).some(Boolean)) return [];
    return detectStructureFvgs(ohlcv).filter((f) => typeOn[f.type] && (showMitOn || f.status !== "full"));
  }, [ohlcv, fvgOn, pfgOn, bfgOn, rfgOn, ifvgOn, showMitOn]);
  const advancedBlocks = useMemo(() => {
    if (!advOn) return [];
    return detectAdvancedOrderBlocks(ohlcv).filter((b) => showMitOn || b.invalidatedK === null);
  }, [ohlcv, advOn, showMitOn]);

  const recomputeZones = () => {
    if (!mountedRef.current) return;
    const chart = chartRef.current, series = candleRef.current;
    if (!chart || !series) { setZoneRects([]); setLabelPos([]); return; }
    const rects: ZoneRect[] = [];
    boxZonesRef.current.forEach((z) => {
      const x1 = chart.timeScale().timeToCoordinate(toChartTime(barKey(z.entry_date)));
      const x2 = chart.timeScale().timeToCoordinate(toChartTime(barKey(z.exit_date)));
      const y1 = series.priceToCoordinate(z.top);
      const y2 = series.priceToCoordinate(z.bottom);
      if (x1 == null || x2 == null || y1 == null || y2 == null || !Number.isFinite(y1) || !Number.isFinite(y2)) return;
      rects.push({
        left: Math.min(x1, x2), width: Math.max(2, Math.abs(x2 - x1)),
        top: Math.min(y1, y2), height: Math.max(1, Math.abs(y2 - y1)),
        fill: z.fill, border: z.border,
      });
    });
    setZoneRects(rects);

    const labels: LabelPos[] = [];
    lineLabelsRef.current.forEach((l) => {
      const x1 = chart.timeScale().timeToCoordinate(toChartTime(l.fromDate));
      const x2 = chart.timeScale().timeToCoordinate(toChartTime(l.toDate));
      const y = series.priceToCoordinate(l.level);
      if (x1 == null || x2 == null || y == null || !Number.isFinite(y)) return;
      labels.push({ left: (x1 + x2) / 2, top: y, text: l.text, color: l.color });
    });
    setLabelPos(labels);
  };

  // priceToCoordinate/timeToCoordinate can return null until the chart has actually
  // completed a layout pass — calling recomputeZones() synchronously right after
  // setData()/fitContent() often computes against a not-yet-ready scale, and a fixed
  // frame-count guess wasn't enough. Poll for up to ~1s instead — cheap (setZoneRects
  // is idempotent) and self-healing regardless of the exact internal timing.
  const scheduleRecompute = () => {
    const ids = [0, 50, 150, 300, 600, 1000].map((delay) => setTimeout(recomputeZones, delay));
    pendingTimeouts.current.push(...ids);
  };

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return;
    // StrictMode (dev) runs mount -> cleanup -> mount; the cleanup flips this to false,
    // so it must be re-armed here or overlay positioning (zones, SMC labels) never runs.
    mountedRef.current = true;
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
      scheduleRecompute();
    });
    ro.observe(containerRef.current);

    return () => {
      mountedRef.current = false;
      pendingTimeouts.current.forEach(clearTimeout);
      pendingTimeouts.current = [];
      chart.timeScale().unsubscribeVisibleTimeRangeChange(recomputeZones);
      ro.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null;
      // Trade-line series belong to the chart instance being destroyed above —
      // drop the stale refs so a later "draw trade markers" effect (which runs
      // independently, e.g. under StrictMode's mount->cleanup->remount in dev)
      // never calls removeSeries() on a series whose chart no longer exists.
      tradeLines.current = [];
    };
  }, []);

  // Keep the ref in sync so the stable subscribed callback always sees current zones —
  // merging in SMC order-block/FVG zones (computed client-side) when their toggles are on.
  useEffect(() => {
    const smcZones: BoxZone[] = [];
    orderBlocks.forEach((b) => smcZones.push({
      entry_date: b.date, exit_date: b.endDate, top: b.top, bottom: b.bottom,
      fill: b.direction === "bullish" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
      border: b.direction === "bullish" ? "#10b981" : "#ef4444",
    }));
    advancedBlocks.forEach((b) => smcZones.push({
      entry_date: b.date, exit_date: b.endDate, top: b.top, bottom: b.bottom,
      fill: b.direction === "bullish" ? "rgba(20,184,166,0.15)" : "rgba(249,115,22,0.15)",
      border: b.direction === "bullish" ? "#14b8a6" : "#f97316",
    }));
    // gaps an order block stands on are drawn at full strength, the rest (and any whose CE has been
    // closed through) dimmer
    fvgs.forEach((f) => {
      const bull = f.direction === "bullish";
      const alpha = f.attached && !f.ceBroken ? 0.14 : 0.06;
      smcZones.push({
        entry_date: f.date, exit_date: f.endDate, top: f.top, bottom: f.bottom,
        fill: f.type === "IFVG" ? `rgba(${bull ? "234,179,8" : "236,72,153"},${alpha})` : `rgba(${bull ? "59,130,246" : "168,85,247"},${alpha})`,
        border: f.type === "IFVG" ? (bull ? "#eab308" : "#ec4899") : (bull ? "#3b82f6" : "#a855f7"),
      });
    });
    boxZonesRef.current = [...boxZones, ...smcZones];
    scheduleRecompute();
  }, [boxZones, ohlcv, orderBlocks, advancedBlocks, fvgs]);

  // Update candle data — only fitContent() when the underlying symbol/data changes,
  // not when the caller swaps ohlcv references for the same stock data.
  useEffect(() => {
    if (!candleRef.current || !ohlcv.length) return;
    const identity = ohlcv[0]?.date + "|" + ohlcv[ohlcv.length - 1]?.date + "|" + ohlcv.length;
    const isNewData = loadedSymRef.current !== identity;
    candleRef.current.setData(
      ohlcv.map((r) => ({
        time: toChartTime(barKey(r.date)),
        open: r.open, high: r.high, low: r.low, close: r.close,
      } as CandlestickData))
    );
    if (isNewData) {
      chartRef.current?.timeScale().fitContent();
      loadedSymRef.current = identity;
    }
    scheduleRecompute();
  }, [ohlcv]);

  // Draw trade markers and h-lines
  useEffect(() => {
    if (!chartRef.current || !ohlcv.length) return;

    // Remove old lines
    tradeLines.current.forEach((s) => chartRef.current?.removeSeries(s));
    tradeLines.current = [];

    const allDates = ohlcv.map((r) => barKey(r.date));
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
      s.setData(slice.map((d) => ({ time: toChartTime(d), value: price } as LineData)));
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
        const entryDate = barKey(t.entry_date);
        const exitDate  = barKey(t.exit_date);
        if (!dateSet.has(entryDate)) return;

        // H-lines only for the active algo to avoid clutter — and only when the
        // trade's price fields share the candle's scale (see hLines prop doc).
        if (active && hLines) {
          addHLine(entryDate, exitDate, t.entry_price,  color);
          addHLine(entryDate, exitDate, t.target_price, "#22c55e");
          addHLine(entryDate, exitDate, t.sl_price,     "#ef4444");
        }

        markers.push({
          time: toChartTime(entryDate),
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
          time: toChartTime(exitDate),
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
      const entryDate = barKey(s.entry_date);
      const exitDate  = barKey(s.exit_date);
      if (!dateSet.has(entryDate)) return;
      addHLine(entryDate, exitDate, s.call_strike, "#f59e0b");
      if (s.put_strike !== s.call_strike) addHLine(entryDate, exitDate, s.put_strike, "#0ea5e9");
    });

    // TA-Lib candle pattern markers from backend
    patternHits.forEach((p) => {
      markers.push({
        time: toChartTime(barKey(p.date)),
        position: "belowBar", shape: "square",
        color: p.bias === "bullish" ? "#9333ea" : p.bias === "bearish" ? "#c026d3" : "#94a3b8",
        text: p.label, size: 1,
      });
    });

    // SMC overlays are drawn as a level between two dates with its label centred on the
    // line (like TradingView), rather than as a marker stuck to a candle.
    const levelLabels: LineLabel[] = [];
    const addLevel = (
      fromDate: string, toDate: string, level: number, color: string, lineStyle: LineStyle, text: string,
    ) => {
      const fromIdx = allDates.indexOf(fromDate);
      const toIdx   = allDates.indexOf(toDate);
      if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx || !chartRef.current) return;
      const s = chartRef.current.addLineSeries({
        color, lineWidth: 1, lineStyle,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(allDates.slice(fromIdx, toIdx + 1).map((d) => ({ time: toChartTime(d), value: level } as LineData)));
      tradeLines.current.push(s);
      levelLabels.push({ fromDate, toDate, level, text, color });
    };

    // Structure map (lecture rules): BOS (continuation) / ChoCH (trend change) are solid levels
    // from the broken swing to the breaking bar; IDM is a dotted level from the inducement swing
    // to the bar that took it. BOS keeps the semantic green/red of its direction, ChoCH is always
    // amber, IDM magenta. HH/HL/LH/LL are tagged on the candle that formed the point.
    if (bosOn || chochOn || idmOn || pointsOn) {
      const map = mapStructure(ohlcv);
      map.events.forEach((ev) => {
        if (ev.type === "BOS" && bosOn) {
          addLevel(ev.fromDate, ev.date, ev.level, ev.direction === "bullish" ? "#16a34a" : "#dc2626", LineStyle.Solid, "BOS");
        } else if (ev.type === "ChoCH" && chochOn) {
          addLevel(ev.fromDate, ev.date, ev.level, "#f59e0b", LineStyle.Solid, "ChoCH");
        } else if (ev.type === "IDM" && idmOn) {
          addLevel(ev.fromDate, ev.date, ev.level, "#d946ef", LineStyle.Dotted, "IDM");
        }
      });
      if (pointsOn) {
        map.points.forEach((p) => {
          const top = p.type === "HH" || p.type === "LH";
          const bullish = p.type === "HH" || p.type === "HL";
          markers.push({
            time: toChartTime(barKey(p.date)),
            position: top ? "aboveBar" : "belowBar",
            shape: "circle", color: bullish ? "#15803d" : "#b91c1c", text: p.type, size: 0,
          });
        });
      }
    }

    // Order block CE (50% midpoint) and advanced-block mean threshold, from the block to where it is drawn to.
    orderBlocks.forEach((b) => addLevel(b.date, b.endDate, b.ce, b.direction === "bullish" ? "#10b981" : "#ef4444", LineStyle.Dotted, "CE"));
    advancedBlocks.forEach((b) => addLevel(b.date, b.endDate, b.mean, b.direction === "bullish" ? "#14b8a6" : "#f97316", LineStyle.Dotted, "50%"));

    fvgs.forEach((f) => addLevel(f.date, f.endDate, f.ce, f.type === "IFVG" ? "#ca8a04" : f.direction === "bullish" ? "#3b82f6" : "#a855f7",
      LineStyle.Dotted, f.type === "FVG" ? "CE" : f.type));

    // Liquidity: equal-highs/equal-lows pools as a dotted level, plus a sweep line from the
    // pool to the bar that first wicks through and rejects back (a liquidity grab).
    if (liqOn) {
      const pools = detectLiquidityPools(ohlcv);
      const LIQ_COLOR = "#06b6d4";
      pools.forEach((pool) => addLevel(pool.startDate, pool.endDate, pool.level, LIQ_COLOR, LineStyle.Dotted, pool.type));
      detectLiquiditySweeps(ohlcv, pools).forEach((sw) =>
        addLevel(sw.pool.endDate, sw.date, sw.pool.level, "#0891b2", LineStyle.Solid, "SWEEP"));
    }

    // Order-block lifecycle: what happened when price came back to a block — absorbed as
    // intended (mitigation), invalidated then held anyway (reclaimed), or invalidated and
    // now flips polarity (breaker). Drawn on the block's near edge from its origin candle.
    if (brkOn || rclOn || mitOn) {
      const BLOCK_ON = { breaker: brkOn, reclaimed: rclOn, mitigation: mitOn } as const;
      const BLOCK_COLOR = { breaker: "#f97316", reclaimed: "#65a30d", mitigation: "#64748b" } as const;
      const BLOCK_LABEL = { breaker: "BRK", reclaimed: "RCL", mitigation: "MIT" } as const;
      detectSmcBlocks(ohlcv).filter((ev) => BLOCK_ON[ev.type]).forEach((ev) => {
        addLevel(ev.originDate, ev.date, ev.direction === "bullish" ? ev.top : ev.bottom,
          BLOCK_COLOR[ev.type], LineStyle.Dashed, BLOCK_LABEL[ev.type]);
      });
    }

    lineLabelsRef.current = levelLabels;
    scheduleRecompute();

    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    candleRef.current?.setMarkers(markers);
  }, [ohlcv, trades, algoTrades, patternHits, hLines, strikeLines, bosOn, chochOn, idmOn, pointsOn, liqOn, brkOn, rclOn, mitOn, orderBlocks, advancedBlocks, fvgs]);

  const isMultiAlgo = algoTrades && algoTrades.length > 0;

  return (
    <div>
      <div className="relative">
        <div ref={containerRef} className="w-full" />
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 5 }}>
          {labelPos.map((l, i) => (
            <span key={`l${i}`} className="absolute -translate-x-1/2 -translate-y-1/2 px-1 rounded text-[9px] font-bold leading-none bg-white/90"
              style={{ left: l.left, top: l.top, color: l.color }}>
              {l.text}
            </span>
          ))}
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
