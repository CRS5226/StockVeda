import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, type IChartApi, type ISeriesApi,
  type CandlestickData, type HistogramData, type LineData, type Time, type MouseEventParams, type IPriceLine,
  type SeriesMarker,
  ColorType, CrosshairMode, LineStyle,
} from "lightweight-charts";
import { BacktestTradeV2 } from "../lib/api";
import type { PatternHit } from "../lib/candlePatterns";
import { mapStructure } from "../lib/smcStructure";
import { DEFAULT_SWING_LENGTH, classifySwingLevels, mapSwingStructure, zigzagPoints } from "../lib/smcSwingStructure";
import { detectSwingFvgs, detectSwingOrderBlocks, detectSwingTypedBlocks, type SwingOrderBlock, type SwingTypedBlock } from "../lib/smcSwingZones";
import type { FvgType } from "../lib/smcFvg";
import { detectStructureFvgs } from "../lib/smcFvg";
import { detectAdvancedOrderBlocks, detectStructureOrderBlocks, type OrderBlock } from "../lib/smcOrderBlocks";
import { detectLiquidityPools, detectLiquiditySweeps } from "../lib/smcLiquidity";
import { detectSmcBlocks } from "../lib/smcBlocks";
import { barKey, toChartTime } from "../lib/barTime";
import { PALETTES, type ChartTheme } from "../lib/chartTheme";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number; volume?: number }

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
  swingLevels: boolean;       // ITH / LTH (ITL / LTL) swing hierarchy; swing mode only
  swingLines: boolean;        // zigzag line joining the swings; swing mode only
  rejection: boolean;         // wick-only block at a pivot candle; swing mode only
}

export const NO_SMC: SmcToggles = {
  bos: false, choch: false, idm: false, points: false,
  orderBlocks: false, advancedBlocks: false, fourCandle: false, showMitigated: false, fvg: false, pfg: false, bfg: false, rfg: false, ifvg: false, liquidity: false,
  breaker: false, reclaimed: false, mitigation: false, swingLevels: false, swingLines: false, rejection: false,
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
  /**
   * Fill the parent (which needs a definite height) instead of the fixed 340px, with a volume
   * histogram, an OHLC readout and no legend footer. Used by the full-screen Charts page.
   */
  fill?: boolean;
  /**
   * How BOS / ChoCH / HH-HL-LH-LL are found. "lecture" (default) uses the strict lecture rules;
   * "swing" counts every confirmed swing, so it marks far more breaks. IDM is lecture-only.
   */
  structureMode?: "lecture" | "swing";
  /** Swing length (bars each side) for "swing" mode. */
  swingLength?: number;
  /** Colour theme of the chart itself; the rest of the page is unaffected. */
  theme?: ChartTheme;
  /**
   * Replay mode: bars are revealed one by one, so a longer data set must not re-fit the view. The view
   * opens on the last ~100 bars and then follows the newest bar.
   */
  stableView?: boolean;
  /** Called with the time of the bar the user clicks. */
  onChartClick?: (time: Time) => void;
  /** Extra markers (for example paper-trade entries and exits), merged with the chart's own. */
  extraMarkers?: SeriesMarker<Time>[];
  /** Horizontal price lines across the chart (for example the entry, stop-loss and target of open trades). */
  priceLines?: ChartPriceLine[];
  /** Called with the chart once it exists, and with null when it is torn down. */
  onChartReady?: (handle: ChartHandle | null) => void;
}

export interface ChartPriceLine { price: number; color: string; title: string; dashed?: boolean }

/** The live chart and its candle series, for overlays that need to convert between prices and screen positions. */
export interface ChartHandle { chart: IChartApi; series: ISeriesApi<"Candlestick"> }

// Colours of the swing-mode block types (breaker / mitigation / rejection) and the label on their CE line.
const BLOCK_KIND_COLORS: Record<SwingTypedBlock["kind"], { rgb: string; hex: string; label: string }> = {
  breaker:    { rgb: "236,72,153",  hex: "#ec4899", label: "BRK" }, // pink
  mitigation: { rgb: "100,116,139", hex: "#64748b", label: "MIT" }, // slate
  rejection:  { rgb: "132,204,22",  hex: "#84cc16", label: "REJ" }, // lime
};

// One colour per FVG type, so a PFG, BFG and RFG can be told apart on the chart.
const FVG_COLORS: Record<FvgType, { rgb: string; hex: string }> = {
  FVG:  { rgb: "59,130,246",  hex: "#3b82f6" }, // blue
  PFG:  { rgb: "139,92,246",  hex: "#8b5cf6" }, // violet
  BFG:  { rgb: "249,115,22",  hex: "#f97316" }, // orange
  RFG:  { rgb: "20,184,166",  hex: "#14b8a6" }, // teal
  IFVG: { rgb: "234,179,8",   hex: "#eab308" }, // yellow
};

interface Readout { open: number; high: number; low: number; close: number; volume?: number }
const fmtPrice = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVolume = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(2)}L` : n.toLocaleString("en-IN");

/** Chart options that depend on the theme; used at creation and when the theme changes. */
function themeOptions(theme: ChartTheme) {
  const p = PALETTES[theme];
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
const EMPTY_MARKERS: SeriesMarker<Time>[] = [];
const EMPTY_PRICE_LINES: ChartPriceLine[] = [];

export default function BacktestChart({
  ohlcv, trades = EMPTY_TRADES, algoTrades, patternHits = EMPTY_PATTERNS, hLines = true,
  strikeLines = EMPTY_STRIKE_LINES, boxZones = EMPTY_BOX_ZONES, smc = NO_SMC,
  fill = false, theme = "light", structureMode = "lecture", swingLength = DEFAULT_SWING_LENGTH,
  stableView = false, onChartClick, extraMarkers = EMPTY_MARKERS, priceLines = EMPTY_PRICE_LINES, onChartReady,
}: Props) {
  const clickRef = useRef(onChartClick);
  clickRef.current = onChartClick;
  const readyRef = useRef(onChartReady);
  readyRef.current = onChartReady;
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastReadout = useRef<Readout | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
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
  const { bos: bosOn, choch: chochOn, idm: idmRaw, points: pointsOn,
          orderBlocks: obOn, advancedBlocks: advRaw, fourCandle: fourOn, showMitigated: showMitOn,
          fvg: fvgOn, pfg: pfgOn, bfg: bfgOn, rfg: rfgOn, ifvg: ifvgOn, liquidity: liqOn,
          breaker: brkRaw, reclaimed: rclRaw, mitigation: mitRaw, swingLevels: slvRaw, swingLines: slnRaw, rejection: rejRaw } = smc;
  // Swing mode has no IDM, advanced or reclaimed block (lecture rules); its breaker / mitigation / rejection
  // blocks come from the swing detectors, and the swing hierarchy, zigzag and rejection exist only there.
  const swingMode = structureMode === "swing";
  const idmOn = !swingMode && idmRaw, advOn = !swingMode && advRaw, brkOn = !swingMode && brkRaw;
  const rclOn = !swingMode && rclRaw, mitOn = !swingMode && mitRaw, slvOn = swingMode && slvRaw, slnOn = swingMode && slnRaw;
  const typedOn = { breaker: swingMode && brkRaw, mitigation: swingMode && mitRaw, rejection: swingMode && rejRaw };

  // Order blocks follow the structure map, so they are computed once per data/toggle change and
  // shared by the zone boxes and the CE / mean lines.
  const orderBlocks = useMemo(() => {
    if (!obOn) return [];
    const blocks: (OrderBlock | SwingOrderBlock)[] = swingMode
      ? detectSwingOrderBlocks(ohlcv, { length: swingLength })
      : detectStructureOrderBlocks(ohlcv);
    // Swing mode always applies the 4-candle rule (a block the 4th candle did not confirm is dropped); the
    // lecture mode keeps it as an option. A block too recent to judge (null) stays.
    return blocks
      .filter((b) => showMitOn || b.status !== "full")
      .filter((b) => !(swingMode || fourOn) || b.followThrough !== false);
  }, [ohlcv, obOn, fourOn, showMitOn, swingMode, swingLength]);
  const fvgs = useMemo(() => {
    const typeOn = { FVG: fvgOn, PFG: fvgOn || pfgOn, BFG: fvgOn || bfgOn, RFG: fvgOn || rfgOn, IFVG: ifvgOn };
    if (!Object.values(typeOn).some(Boolean)) return [];
    const all = swingMode ? detectSwingFvgs(ohlcv, { length: swingLength }) : detectStructureFvgs(ohlcv);
    return all.filter((f) => typeOn[f.type] && (showMitOn || f.status !== "full"));
  }, [ohlcv, fvgOn, pfgOn, bfgOn, rfgOn, ifvgOn, showMitOn, swingMode, swingLength]);
  const advancedBlocks = useMemo(() => {
    if (!advOn) return [];
    return detectAdvancedOrderBlocks(ohlcv).filter((b) => showMitOn || b.invalidatedK === null);
  }, [ohlcv, advOn, showMitOn]);
  // Breaker / mitigation / rejection blocks of the swing structure (the lecture mode draws its own lines).
  const typedBlocks = useMemo(() => {
    if (!typedOn.breaker && !typedOn.mitigation && !typedOn.rejection) return [] as SwingTypedBlock[];
    return detectSwingTypedBlocks(ohlcv, { length: swingLength })
      .filter((b) => typedOn[b.kind] && (showMitOn || b.status !== "full"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ohlcv, typedOn.breaker, typedOn.mitigation, typedOn.rejection, showMitOn, swingLength]);

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
    const initial = themeOptions(themeRef.current);
    const chart = createChart(containerRef.current, {
      ...initial,
      crosshair: { mode: CrosshairMode.Normal, ...initial.crosshair },
      timeScale: { ...initial.timeScale, timeVisible: true, ...(fill ? { rightOffset: 6 } : {}) },
      width: containerRef.current.clientWidth,
      height: fill ? containerRef.current.clientHeight : 340,
    });
    chartRef.current = chart;

    const cs = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      borderVisible: false,
    });
    candleRef.current = cs;

    // Full-screen mode adds a volume histogram under the candles and an OHLC readout.
    let onMove: ((p: MouseEventParams) => void) | null = null;
    if (fill) {
      const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeRef.current = vol;
      onMove = (p) => {
        const c = p.seriesData.get(cs) as CandlestickData | undefined;
        if (!c || !("open" in c)) { setReadout(lastReadout.current); return; }
        const v = p.seriesData.get(vol) as HistogramData | undefined;
        setReadout({ open: c.open, high: c.high, low: c.low, close: c.close, volume: v?.value });
      };
      chart.subscribeCrosshairMove(onMove);
    }

    chart.timeScale().subscribeVisibleTimeRangeChange(recomputeZones);

    const onClick = (p: MouseEventParams) => { if (p.time !== undefined) clickRef.current?.(p.time); };
    chart.subscribeClick(onClick);
    readyRef.current?.({ chart, series: cs });

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions(fill
          ? { width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }
          : { width: containerRef.current.clientWidth });
      scheduleRecompute();
    });
    ro.observe(containerRef.current);

    return () => {
      mountedRef.current = false;
      pendingTimeouts.current.forEach(clearTimeout);
      pendingTimeouts.current = [];
      chart.timeScale().unsubscribeVisibleTimeRangeChange(recomputeZones);
      if (onMove) chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      readyRef.current?.(null);
      priceLineRefs.current = [];
      ro.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      // Trade-line series belong to the chart instance being destroyed above —
      // drop the stale refs so a later "draw trade markers" effect (which runs
      // independently, e.g. under StrictMode's mount->cleanup->remount in dev)
      // never calls removeSeries() on a series whose chart no longer exists.
      tradeLines.current = [];
    };
  }, []);

  // Recolour the live chart when the theme changes (no rebuild, so zoom and scroll are kept).
  useEffect(() => {
    chartRef.current?.applyOptions(themeOptions(theme));
  }, [theme]);

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
    typedBlocks.forEach((b) => smcZones.push({
      entry_date: b.date, exit_date: b.endDate, top: b.top, bottom: b.bottom,
      fill: `rgba(${BLOCK_KIND_COLORS[b.kind].rgb},0.15)`, border: BLOCK_KIND_COLORS[b.kind].hex,
    }));
    // gaps an order block stands on are drawn at full strength, the rest (and any whose CE has been
    // closed through) dimmer
    fvgs.forEach((f) => {
      const alpha = f.attached && !f.ceBroken ? 0.14 : 0.06;
      smcZones.push({
        entry_date: f.date, exit_date: f.endDate, top: f.top, bottom: f.bottom,
        fill: `rgba(${FVG_COLORS[f.type].rgb},${alpha})`,
        border: FVG_COLORS[f.type].hex,
      });
    });
    boxZonesRef.current = [...boxZones, ...smcZones];
    scheduleRecompute();
  }, [boxZones, ohlcv, orderBlocks, advancedBlocks, typedBlocks, fvgs]);

  // Update candle data — only fitContent() when the underlying symbol/data changes,
  // not when the caller swaps ohlcv references for the same stock data.
  useEffect(() => {
    if (!candleRef.current || !ohlcv.length) return;
    // In replay the bars grow one at a time, so only the first bar (and the replay switch) names the data set.
    const identity = stableView
      ? "replay|" + ohlcv[0]?.date
      : ohlcv[0]?.date + "|" + ohlcv[ohlcv.length - 1]?.date + "|" + ohlcv.length;
    const isNewData = loadedSymRef.current !== identity;
    candleRef.current.setData(
      ohlcv.map((r) => ({
        time: toChartTime(barKey(r.date)),
        open: r.open, high: r.high, low: r.low, close: r.close,
      } as CandlestickData))
    );
    if (volumeRef.current) {
      volumeRef.current.setData(
        ohlcv.map((r) => ({
          time: toChartTime(barKey(r.date)), value: r.volume ?? 0,
          color: r.close >= r.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
        } as HistogramData))
      );
      const last = ohlcv[ohlcv.length - 1];
      lastReadout.current = { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume };
      setReadout(lastReadout.current);
    }
    if (isNewData) {
      if (stableView) {
        chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, ohlcv.length - 100), to: ohlcv.length + 6 });
      } else {
        chartRef.current?.timeScale().fitContent();
      }
      loadedSymRef.current = identity;
    } else if (stableView) {
      chartRef.current?.timeScale().scrollToRealTime(); // follow the newest revealed bar, keeping the zoom
    }
    scheduleRecompute();
  }, [ohlcv, stableView]);

  // Horizontal lines for open paper trades: drop the old ones and draw the current set.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    priceLineRefs.current.forEach((l) => series.removePriceLine(l));
    priceLineRefs.current = priceLines.map((l) => series.createPriceLine({
      price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
      axisLabelVisible: true, title: l.title,
    }));
  }, [priceLines]);

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
      const map = structureMode === "swing" ? mapSwingStructure(ohlcv, { length: swingLength }) : mapStructure(ohlcv);
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

    // Zigzag: one line joining the swings in order (a run of same-side swings keeps the most extreme).
    if (slnOn && chartRef.current) {
      const zz = zigzagPoints(ohlcv, swingLength);
      if (zz.length > 1) {
        const line = chartRef.current.addLineSeries({
          color: "#64748b", lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        line.setData(zz.map((p) => ({ time: toChartTime(p.date), value: p.price } as LineData)));
        tradeLines.current.push(line);
      }
    }

    // Swing hierarchy: intermediate and long-term swings only (every plain swing is already a HH / HL / LH / LL).
    if (slvOn) {
      classifySwingLevels(ohlcv, swingLength).filter((s) => s.level !== "S").forEach((s) => {
        const top = s.side === "high";
        markers.push({
          time: toChartTime(s.date),
          position: top ? "aboveBar" : "belowBar",
          shape: "circle", color: s.level === "L" ? "#7c3aed" : "#d97706", size: 0,
          text: `${s.level}T${top ? "H" : "L"}`,
        });
      });
    }

    // Order block CE (50% midpoint) and advanced-block mean threshold, from the block to where it is drawn to.
    orderBlocks.forEach((b) => addLevel(b.date, b.endDate, b.ce, b.direction === "bullish" ? "#10b981" : "#ef4444", LineStyle.Dotted, "CE"));
    // An IFVG zone starts where its gap formed, so mark the candle that closed through the gap.
    if (swingMode) {
      fvgs.filter((f) => f.type === "IFVG" && f.invertedDate).forEach((f) => markers.push({
        time: toChartTime(f.invertedDate!), position: f.direction === "bullish" ? "belowBar" : "aboveBar",
        shape: "circle", color: FVG_COLORS.IFVG.hex, text: "IFVG", size: 0,
      }));
    }

    typedBlocks.forEach((b) => addLevel(b.date, b.endDate, b.ce, BLOCK_KIND_COLORS[b.kind].hex, LineStyle.Dotted, BLOCK_KIND_COLORS[b.kind].label));
    advancedBlocks.forEach((b) => addLevel(b.date, b.endDate, b.mean, b.direction === "bullish" ? "#14b8a6" : "#f97316", LineStyle.Dotted, "50%"));

    fvgs.forEach((f) => addLevel(f.date, f.endDate, f.ce, FVG_COLORS[f.type].hex,
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

    markers.push(...extraMarkers);
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    candleRef.current?.setMarkers(markers);
  }, [ohlcv, trades, algoTrades, patternHits, hLines, strikeLines, bosOn, chochOn, idmOn, pointsOn, liqOn, brkOn, rclOn, mitOn, slvOn, slnOn, orderBlocks, advancedBlocks, typedBlocks, fvgs, structureMode, swingLength, swingMode, extraMarkers]);

  const isMultiAlgo = algoTrades && algoTrades.length > 0;

  const dark = theme === "dark";
  const readoutColor = readout && readout.close < readout.open ? "text-red-500" : "text-emerald-500";

  return (
    <div className={fill ? "w-full h-full" : undefined}>
      <div className={fill ? "relative w-full h-full" : "relative"}>
        <div ref={containerRef} className={fill ? "absolute inset-0" : "w-full"} />
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 5 }}>
          {fill && readout && (
            <div className={`absolute top-2 left-3 flex flex-wrap gap-x-3 text-xs font-medium select-none rounded px-1.5 py-0.5 ${dark ? "bg-[#131722]/80" : "bg-white/80"}`}>
              <span className="text-slate-500">O <span className={readoutColor}>{fmtPrice(readout.open)}</span></span>
              <span className="text-slate-500">H <span className={readoutColor}>{fmtPrice(readout.high)}</span></span>
              <span className="text-slate-500">L <span className={readoutColor}>{fmtPrice(readout.low)}</span></span>
              <span className="text-slate-500">C <span className={readoutColor}>{fmtPrice(readout.close)}</span></span>
              {readout.volume !== undefined && <span className="text-slate-500">Vol <span className={readoutColor}>{fmtVolume(readout.volume)}</span></span>}
            </div>
          )}
          {labelPos.map((l, i) => (
            <span key={`l${i}`} className={`absolute -translate-x-1/2 -translate-y-1/2 px-1 rounded text-[9px] font-bold leading-none ${dark ? "bg-[#131722]/90" : "bg-white/90"}`}
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
      {!fill && <div className="flex gap-3 px-3 py-1 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex-wrap">
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
      </div>}
    </div>
  );
}
