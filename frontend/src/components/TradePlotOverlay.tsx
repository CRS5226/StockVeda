import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Logical, MouseEventParams } from "lightweight-charts";
import { X } from "lucide-react";
import type { PlotDraft, PlottedTrade } from "../lib/api";
import { barKey } from "../lib/barTime";
import { money, percent, points, price as fmt } from "../lib/formatTrade";
import {
  barIndexAtOrBefore, chartTimeToNorm, clampLevel, indexToTime, newPlotDraft, normTime, plotMetrics, timeToIndex, toApiTime,
  toDraft, type PlotSide,
} from "../lib/tradePlot";

type Handle = "stop" | "target" | "entry" | "end";

interface Props {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  /** The bars on the chart; a box is anchored to a bar by its time. */
  bars: { date: string }[];
  symbol: string;
  plots: PlottedTrade[];
  /** Trade plot mode is on: boxes can be placed, dragged and deleted. Off: they are only drawn. */
  editable: boolean;
  /** The armed tool: the next click on the chart places a box of this side. */
  tool: PlotSide | null;
  dark: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (draft: PlotDraft) => Promise<PlottedTrade | null>;
  onChange: (id: number, draft: PlotDraft) => void;
  onDelete: (id: number) => void;
  onToolDone: () => void;
}

interface Box { id: number; x0: number; x1: number; yEntry: number; yStop: number; yTarget: number }
interface Frame { boxes: Box[]; paneWidth: number }

const BLUE = "#3b82f6", GREEN = "#22c55e", RED = "#ef4444";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Screen positions of every box, refreshed each frame so they follow zoom, scroll and price-axis changes. */
function useFrame(chart: IChartApi, series: ISeriesApi<"Candlestick">, plots: PlottedTrade[], barTimes: string[]): Frame {
  const [frame, setFrame] = useState<Frame>({ boxes: [], paneWidth: 0 });
  const latest = useRef({ plots, barTimes });
  latest.current = { plots, barTimes };
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      try {
        const { plots: ps, barTimes: times } = latest.current;
        const scale = chart.timeScale();
        const boxes: Box[] = [];
        for (const p of ps) {
          const ei = timeToIndex(times, normTime(p.entry_time));
          if (ei < 0) continue;
          const xi = timeToIndex(times, normTime(p.end_time));
          const x0 = scale.logicalToCoordinate(ei as unknown as Logical);
          const x1 = scale.logicalToCoordinate(Math.max(xi, ei + 1) as unknown as Logical);
          const yEntry = series.priceToCoordinate(p.entry_price);
          const yStop = series.priceToCoordinate(p.stop_loss);
          const yTarget = series.priceToCoordinate(p.target);
          if (x0 === null || x1 === null || yEntry === null || yStop === null || yTarget === null) continue;
          boxes.push({ id: p.id, x0, x1, yEntry, yStop, yTarget });
        }
        const next: Frame = { boxes, paneWidth: chart.paneSize().width };
        setFrame((prev) =>
          prev.paneWidth === next.paneWidth && prev.boxes.length === next.boxes.length
          && prev.boxes.every((b, i) => {
            const n = next.boxes[i];
            return b.id === n.id && Math.abs(b.x0 - n.x0) < 0.5 && Math.abs(b.x1 - n.x1) < 0.5 && Math.abs(b.yEntry - n.yEntry) < 0.5
              && Math.abs(b.yStop - n.yStop) < 0.5 && Math.abs(b.yTarget - n.yTarget) < 0.5;
          }) ? prev : next);
        raf = requestAnimationFrame(tick);
      } catch {
        /* the chart was torn down: stop */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chart, series]);
  return frame;
}

/**
 * Long / short trade boxes drawn over the chart: a green zone from the entry to the target and a red zone from
 * the entry to the stop-loss, with points, percent and risk-reward on each. In trade plot mode the next click
 * places a box, and the stop-loss, target, entry (moves the whole box) and right edge can be dragged.
 */
export default function TradePlotOverlay(props: Props) {
  const { chart, series, bars, symbol, plots, editable, tool, dark, selectedId } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const barTimes = useMemo(() => bars.map((b) => normTime(barKey(b.date))), [bars]);
  const [drag, setDrag] = useState<{ id: number; patch: Partial<PlotDraft> } | null>(null);
  const dragRef = useRef<{ base: PlottedTrade; handle: Handle; patch: Partial<PlotDraft> | null } | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const shown = useMemo(
    () => plots.map((p) => (drag && drag.id === p.id ? { ...p, ...drag.patch } : p)),
    [plots, drag],
  );
  const { boxes, paneWidth } = useFrame(chart, series, shown, barTimes);

  // Armed tool: the next click on the chart places a box at that bar and price.
  useEffect(() => {
    if (!editable || !tool) return;
    const onClick = (p: MouseEventParams) => {
      if (!p.point || p.time === undefined) return;
      const entry = series.coordinateToPrice(p.point.y);
      const index = barIndexAtOrBefore(barTimes, chartTimeToNorm(p.time as Parameters<typeof chartTimeToNorm>[0]));
      if (entry === null || index < 0) return;
      const { onCreate, onSelect, onToolDone } = latest.current;
      onToolDone();
      void onCreate(newPlotDraft(symbol, tool, barTimes, index, entry)).then((saved) => { if (saved) onSelect(saved.id); });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") latest.current.onToolDone(); };
    chart.subscribeClick(onClick);
    window.addEventListener("keydown", onKey);
    return () => { chart.unsubscribeClick(onClick); window.removeEventListener("keydown", onKey); };
  }, [chart, series, editable, tool, barTimes, symbol]);

  const startDrag = (e: React.PointerEvent, plot: PlottedTrade, handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { base: plot, handle, patch: null };
    props.onSelect(plot.id);
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const { base } = d;
    let patch: Partial<PlotDraft> | null = null;
    if (d.handle === "end") {
      const logical = chart.timeScale().coordinateToLogical(e.clientX - rect.left);
      if (logical === null) return;
      const entryIndex = timeToIndex(barTimes, normTime(base.entry_time));
      patch = { end_time: toApiTime(indexToTime(barTimes, Math.max(entryIndex + 1, Math.round(logical)))) };
    } else {
      const price = series.coordinateToPrice(e.clientY - rect.top);
      if (price === null) return;
      if (d.handle === "stop") patch = { stop_loss: round2(clampLevel(base.side, base.entry_price, "stop", price)) };
      else if (d.handle === "target") patch = { target: round2(clampLevel(base.side, base.entry_price, "target", price)) };
      else {
        const delta = round2(price - base.entry_price);
        const moved = { entry_price: round2(base.entry_price + delta), stop_loss: round2(base.stop_loss + delta), target: round2(base.target + delta) };
        if (Object.values(moved).some((n) => n <= 0)) return;
        patch = moved;
      }
    }
    d.patch = patch;
    setDrag({ id: base.id, patch });
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d?.patch) props.onChange(d.base.id, toDraft({ ...d.base, ...d.patch }));
  };

  const chip = `absolute pointer-events-none select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums shadow-sm ${
    dark ? "bg-[#1e222d]/90 text-slate-200" : "bg-white/90 text-slate-700"
  }`;

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 9 }}>
      {tool && editable && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold shadow-lg">
          Click the chart to place a {tool} trade box (Esc to cancel)
        </div>
      )}
      {boxes.map((b) => {
        const plot = shown.find((p) => p.id === b.id);
        if (!plot) return null;
        const left = Math.max(b.x0, 0), right = Math.min(b.x1, paneWidth);
        if (right <= left) return null;
        const width = right - left;
        const m = plotMetrics(plot);
        const selected = plot.id === selectedId;
        const targetUp = b.yTarget < b.yEntry, stopUp = b.yStop < b.yEntry;
        const zone = (y: number, color: string, fill: string) => (
          <div className="absolute pointer-events-none"
            style={{ left, width, top: Math.min(y, b.yEntry), height: Math.abs(y - b.yEntry), background: fill, borderTop: `1px solid ${color}`, borderBottom: `1px solid ${color}` }} />
        );
        const strip = (y: number, handle: Handle, cursor: string) => (
          <div className="absolute pointer-events-auto" style={{ left, width, top: y - 6, height: 12, cursor }}
            onPointerDown={(e) => startDrag(e, plot as PlottedTrade, handle)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
        );
        const rr = m.rr === null ? "" : ` · RR ${m.rr.toFixed(2)}`;
        const amount = (v: number | null) => (v === null ? "" : ` · ${money(v)}`);
        return (
          <div key={plot.id}>
            {zone(b.yTarget, GREEN, "rgba(34,197,94,0.14)")}
            {zone(b.yStop, RED, "rgba(239,68,68,0.14)")}
            <div className="absolute pointer-events-none" style={{ left, width, top: b.yEntry, borderTop: `${selected ? 2 : 1}px solid ${BLUE}` }} />
            <div className={chip} style={{ left: left + 6, top: targetUp ? b.yTarget + 3 : b.yTarget - 21, color: GREEN }}>
              Target {fmt(m.target.price)} · {points(m.target.points)} · {percent(m.target.pct)}{rr}{amount(m.target.money)}
            </div>
            <div className={chip} style={{ left: left + 6, top: stopUp ? b.yStop + 3 : b.yStop - 21, color: RED }}>
              Stop {fmt(m.stop.price)} · {points(m.stop.points)} · {percent(m.stop.pct)}{amount(m.stop.money)}
            </div>
            <div className={`${chip} pointer-events-auto flex items-center gap-1.5`} style={{ left: left + 6, top: b.yEntry - 11, borderLeft: `3px solid ${BLUE}` }}
              onPointerDown={(e) => { e.stopPropagation(); props.onSelect(plot.id); }}>
              <span className={`font-bold ${plot.side === "long" ? "text-emerald-500" : "text-red-500"}`}>{plot.side === "long" ? "LONG" : "SHORT"}</span>
              <span>{fmt(plot.entry_price)}</span>
              {m.rr !== null && <span>RR {m.rr.toFixed(2)}</span>}
              {editable && selected && (
                <button title="Delete this trade box" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onDelete(plot.id)}
                  className="p-0.5 rounded hover:bg-slate-500/20"><X size={12} /></button>
              )}
            </div>
            {editable && (
              <>
                {strip(b.yTarget, "target", "ns-resize")}
                {strip(b.yStop, "stop", "ns-resize")}
                {strip(b.yEntry, "entry", "move")}
                <div className="absolute pointer-events-auto"
                  style={{ left: right - 6, width: 12, top: Math.min(b.yTarget, b.yStop, b.yEntry), height: Math.max(Math.abs(b.yTarget - b.yStop), 12), cursor: "ew-resize" }}
                  onPointerDown={(e) => startDrag(e, plot as PlottedTrade, "end")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
