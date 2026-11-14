import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Logical, MouseEventParams } from "lightweight-charts";
import { X } from "lucide-react";
import type { PlotDraft, PlottedTrade } from "../lib/api";
import { barKey } from "../lib/barTime";
import {
  barIndexAtOrBefore, chartTimeToNorm, clampLevel, indexToTime, newPlotDraft, normTime, plotMetrics, timeToIndex, toApiTime,
  toDraft, type PlotSide,
} from "../lib/tradePlot";

type Handle = "stop" | "target" | "entry" | "end";

interface Props {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  /** The bars on the chart; a box is anchored to a bar by its time. */
  bars: { date: string; close: number }[];
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

const BLUE = "#3b82f6", TEAL = "#089981", CORAL = "#f23645";
const num = (n: number, digits = 2, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
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

  // A click on a box selects it (its labels and handles show); a click anywhere else on the chart hides them again.
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  useEffect(() => {
    if (tool) return;
    const onClick = (p: MouseEventParams) => {
      const { onSelect } = latest.current;
      if (!p.point) return;
      const { x, y } = p.point;
      const hit = [...boxesRef.current].reverse().find((b) =>
        x >= Math.min(b.x0, b.x1) && x <= Math.max(b.x0, b.x1) && y >= Math.min(b.yTarget, b.yStop, b.yEntry) && y <= Math.max(b.yTarget, b.yStop, b.yEntry));
      onSelect(hit ? hit.id : null);
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [chart, tool]);

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
        const zone = (y: number, fill: string) => (
          <div className="absolute pointer-events-none"
            style={{ left, width, top: Math.min(y, b.yEntry), height: Math.abs(y - b.yEntry), background: fill }} />
        );
        const strip = (y: number, handle: Handle, cursor: string) => (
          <div className="absolute pointer-events-auto" style={{ left, width, top: y - 6, height: 12, cursor }}
            onPointerDown={(e) => startDrag(e, plot as PlottedTrade, handle)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
        );
        const cx = (left + right) / 2;
        const last = bars.length ? bars[bars.length - 1].close : null;
        const openPts = last === null ? null : (last - plot.entry_price) * (plot.side === "long" ? 1 : -1);
        const openPnl = openPts === null ? null : plot.qty ? openPts * plot.qty : openPts;
        const gain = (openPts ?? 0) >= 0;
        const tint = gain ? TEAL : CORAL;
        const levelText = (name: string, l: { points: number; pct: number; money: number | null }) =>
          `${name}: ${num(Math.abs(l.points))} (${num(Math.abs(l.pct), 3)}%) ${Math.round(Math.abs(l.points) * 100).toLocaleString("en-IN")}`
          + (l.money === null ? "" : `, Amount: ${num(Math.abs(l.money))}`);
        const label = "absolute pointer-events-none select-none whitespace-nowrap rounded px-2 py-1 text-xs font-medium tabular-nums text-white -translate-x-1/2";
        const knob = (x: number, y: number, round: boolean) => (
          <div className="absolute pointer-events-none"
            style={{ left: x - 5, top: y - 5, width: 10, height: 10, borderRadius: round ? 5 : 2, background: dark ? "#131722" : "#fff", border: `2px solid ${BLUE}` }} />
        );
        return (
          <div key={plot.id}>
            {zone(b.yTarget, "rgba(8,153,129,0.22)")}
            {zone(b.yStop, "rgba(242,54,69,0.22)")}
            <div className="absolute pointer-events-none" style={{ left, width, top: b.yEntry, borderTop: `${selected ? 2 : 1}px solid ${selected ? BLUE : "#9ca3af"}` }} />
            {selected && <>
            <div className={label} style={{ left: cx, top: targetUp ? b.yTarget - 26 : b.yTarget + 4, background: TEAL }}>{levelText("Target", m.target)}</div>
            <div className={label} style={{ left: cx, top: stopUp ? b.yStop - 26 : b.yStop + 4, background: CORAL }}>{levelText("Stop", m.stop)}</div>
            </>}
            {selected && <div className="absolute pointer-events-auto -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-center leading-tight tabular-nums shadow"
              // beside the box, so it never covers the Target / Stop labels
              style={{ left: Math.max(left, Math.min(right + 10, paneWidth - 210)), top: b.yEntry, background: dark ? "#1e222d" : "#fff", color: dark ? "#e2e8f0" : "#0f172a", border: `1.5px solid ${tint}` }}
              onPointerDown={(e) => { e.stopPropagation(); props.onSelect(plot.id); }}>
              <div>
                <span className={plot.side === "long" ? "text-emerald-500 font-bold" : "text-red-500 font-bold"}>{plot.side === "long" ? "LONG" : "SHORT"}</span>
                {openPnl !== null && <> · Open P&amp;L: {num(openPnl, 2, true)}{plot.qty ? `, Qty: ${plot.qty}` : ""}</>}
              </div>
              {m.rr !== null && <div>Risk/Reward Ratio: {m.rr.toFixed(2)}</div>}
              {editable && selected && (
                <button title="Delete this trade box" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onDelete(plot.id)}
                  className="absolute -top-2 -right-2 p-0.5 rounded-full bg-slate-600 text-white"><X size={10} /></button>
              )}
            </div>}
            {editable && (
              <>
                {strip(b.yTarget, "target", "ns-resize")}
                {strip(b.yStop, "stop", "ns-resize")}
                {strip(b.yEntry, "entry", "move")}
                <div className="absolute pointer-events-auto"
                  style={{ left: right - 6, width: 12, top: Math.min(b.yTarget, b.yStop, b.yEntry), height: Math.max(Math.abs(b.yTarget - b.yStop), 12), cursor: "ew-resize" }}
                  onPointerDown={(e) => startDrag(e, plot as PlottedTrade, "end")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                {selected && (
                  <>
                    {knob(left, b.yTarget, false)}
                    {knob(left, b.yStop, true)}
                    {knob(left, b.yEntry, true)}
                    {knob(right, b.yEntry, false)}
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
