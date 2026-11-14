import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Logical, MouseEventParams } from "lightweight-charts";
import { Trash2 } from "lucide-react";
import type { ChartDrawing, DrawingDraft } from "../lib/api";
import { barKey } from "../lib/barTime";
import {
  applyHandle, DRAW_COLORS, newDrawing, toDrawingDraft, translate, type DrawKind, type Handle,
} from "../lib/drawings";
import { barIndexAtOrBefore, chartTimeToNorm, indexToTime, normTime, timeToIndex } from "../lib/tradePlot";

interface Props {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  bars: { date: string }[];
  symbol: string;
  drawings: ChartDrawing[];
  /** The armed tool: the next click (two for a line or rectangle) draws one. */
  tool: DrawKind | null;
  dark: boolean;
  onCreate: (draft: DrawingDraft) => Promise<ChartDrawing | null>;
  onChange: (id: number, draft: DrawingDraft) => void;
  onDelete: (id: number) => void;
  /** The selected drawing; owned by the page so the Layers panel can select one too. */
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onToolDone: () => void;
}

interface Shape { id: number; kind: DrawKind; color: string; x1: number; y1: number; x2: number; y2: number; price: number }
type Point = { time: string; price: number };
type Drag =
  | { base: ChartDrawing; mode: "handle"; handle: Handle; patch: DrawingDraft | null }
  | { base: ChartDrawing; mode: "move"; startLogical: number; startPrice: number; patch: DrawingDraft | null };

const BLUE = "#3b82f6";
const PREVIEW_ID = 0;

/** Screen positions of every drawing, refreshed each frame so they follow zoom, scroll and price-axis changes. */
function useShapes(chart: IChartApi, series: ISeriesApi<"Candlestick">, drawings: ChartDrawing[], barTimes: string[]) {
  const [frame, setFrame] = useState<{ shapes: Shape[]; width: number }>({ shapes: [], width: 0 });
  const latest = useRef({ drawings, barTimes });
  latest.current = { drawings, barTimes };
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      try {
        const { drawings: ds, barTimes: times } = latest.current;
        const scale = chart.timeScale();
        const shapes: Shape[] = [];
        for (const d of ds) {
          const i1 = timeToIndex(times, normTime(d.time1)), i2 = timeToIndex(times, normTime(d.time2));
          if (i1 < 0 || i2 < 0) continue;
          const x1 = scale.logicalToCoordinate(i1 as unknown as Logical), x2 = scale.logicalToCoordinate(i2 as unknown as Logical);
          const y1 = series.priceToCoordinate(d.price1), y2 = series.priceToCoordinate(d.price2);
          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
          shapes.push({ id: d.id, kind: d.kind, color: d.color, x1, y1, x2, y2, price: d.price1 });
        }
        const width = chart.paneSize().width;
        setFrame((prev) =>
          prev.width === width && prev.shapes.length === shapes.length
          && prev.shapes.every((s, i) => {
            const n = shapes[i];
            return s.id === n.id && s.color === n.color && Math.abs(s.x1 - n.x1) < 0.5 && Math.abs(s.x2 - n.x2) < 0.5
              && Math.abs(s.y1 - n.y1) < 0.5 && Math.abs(s.y2 - n.y2) < 0.5;
          }) ? prev : { shapes, width });
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

/** Lines and rectangles drawn over the chart. Drag the border to move one, a knob to resize it; they are saved per symbol. */
export default function DrawingsOverlay(props: Props) {
  const { chart, series, bars, symbol, drawings, tool, dark } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const barTimes = useMemo(() => bars.map((b) => normTime(barKey(b.date))), [bars]);
  const { selectedId, onSelect: setSelectedId } = props;
  const [pending, setPending] = useState<Point | null>(null); // first click of a line / rectangle
  const [hover, setHover] = useState<Point | null>(null);
  const [drag, setDrag] = useState<{ id: number; patch: DrawingDraft } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // A different symbol or tool starts clean.
  useEffect(() => { setPending(null); setHover(null); }, [tool, symbol]);
  useEffect(() => { setSelectedId(null); }, [symbol]);

  const shown = useMemo(() => {
    const list = drawings.map((d) => (drag && drag.id === d.id ? { ...d, ...drag.patch } : d));
    if (tool && pending && hover) {
      list.push({ ...newDrawing(symbol, tool, pending, hover), id: PREVIEW_ID, created_at: "", updated_at: "" });
    }
    return list;
  }, [drawings, drag, tool, pending, hover, symbol]);
  const { shapes, width } = useShapes(chart, series, shown, barTimes);

  // Armed tool: clicks place the anchors; with no tool, a click on empty chart clears the selection.
  useEffect(() => {
    const onClick = (p: MouseEventParams) => {
      const { onCreate, onToolDone } = latest.current;
      if (!tool) { setSelectedId(null); return; }
      if (!p.point || p.time === undefined) return;
      const price = series.coordinateToPrice(p.point.y);
      const index = barIndexAtOrBefore(barTimes, chartTimeToNorm(p.time as Parameters<typeof chartTimeToNorm>[0]));
      if (price === null || index < 0) return;
      const here: Point = { time: barTimes[index], price };
      if (!pending) { setPending(here); return; }
      const draft = newDrawing(symbol, tool, pending, here);
      setPending(null); setHover(null);
      onToolDone();
      void onCreate(draft).then((saved) => { if (saved) setSelectedId(saved.id); });
    };
    const onMove = (p: MouseEventParams) => {
      if (!tool || !pending || !p.point || p.time === undefined) return;
      const price = series.coordinateToPrice(p.point.y);
      const index = barIndexAtOrBefore(barTimes, chartTimeToNorm(p.time as Parameters<typeof chartTimeToNorm>[0]));
      if (price !== null && index >= 0) setHover({ time: barTimes[index], price });
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeClick(onClick); chart.unsubscribeCrosshairMove(onMove); };
  }, [chart, series, tool, pending, barTimes, symbol]);

  // Esc cancels the tool; Delete removes the selected drawing (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select");
      if (e.key === "Escape") { setPending(null); setHover(null); latest.current.onToolDone(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null && !typing) {
        latest.current.onDelete(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const logicalAt = (clientX: number) => (rootRef.current ? chart.timeScale().coordinateToLogical(clientX - rootRef.current.getBoundingClientRect().left) : null);
  const priceAt = (clientY: number) => (rootRef.current ? series.coordinateToPrice(clientY - rootRef.current.getBoundingClientRect().top) : null);

  const startDrag = (e: React.PointerEvent, base: ChartDrawing, how: { handle: Handle } | "move") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSelectedId(base.id);
    if (how === "move") {
      const startLogical = logicalAt(e.clientX), startPrice = priceAt(e.clientY);
      if (startLogical === null || startPrice === null) return;
      dragRef.current = { base, mode: "move", startLogical, startPrice, patch: null };
    } else {
      dragRef.current = { base, mode: "handle", handle: how.handle, patch: null };
    }
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const logical = logicalAt(e.clientX), price = priceAt(e.clientY);
    if (logical === null || price === null) return;
    const base = toDrawingDraft(d.base);
    let patch: DrawingDraft | null;
    if (d.mode === "handle") {
      patch = applyHandle(base, d.handle, indexToTime(barTimes, Math.max(0, Math.round(logical))), price);
      if (patch.price1 <= 0 || patch.price2 <= 0) return;
    } else {
      patch = translate(base, barTimes, Math.round(logical - d.startLogical), price - d.startPrice);
      if (!patch) return;
    }
    d.patch = patch;
    setDrag({ id: d.base.id, patch });
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d?.patch) props.onChange(d.base.id, d.patch);
  };

  const selected = drawings.find((d) => d.id === selectedId) ?? null;
  const handlers = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag };
  const hint = tool ? (pending ? "Click again to finish" : `Click the chart to start the ${tool === "rect" ? "rectangle" : tool === "hline" ? "horizontal line" : "trend line"}`) : "";

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 8 }}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {shapes.map((s) => {
          const d = shown.find((x) => x.id === s.id);
          if (!d) return null;
          const preview = s.id === PREVIEW_ID;
          const isSel = s.id === selectedId;
          const base = d as ChartDrawing;
          const grab = { stroke: "transparent", strokeWidth: 12, fill: "none", pointerEvents: (preview ? "none" : "stroke") as "none" | "stroke", style: { cursor: "move" } };
          const hit = preview ? {} : { onPointerDown: (e: React.PointerEvent) => startDrag(e, base, "move"), ...handlers };
          const dash = preview ? "5 4" : undefined;
          const knobs: { x: number; y: number; handle: Handle }[] = preview || !isSel ? [] : d.kind === "line"
            ? [{ x: s.x1, y: s.y1, handle: { t: 1, p: 1 } }, { x: s.x2, y: s.y2, handle: { t: 2, p: 2 } }]
            : d.kind === "hline"
              ? [{ x: s.x1, y: s.y1, handle: { t: 1, p: 1 } }, { x: s.x2, y: s.y1, handle: { t: 2, p: 2 } }]
              : [{ x: s.x1, y: s.y1, handle: { t: 1, p: 1 } }, { x: s.x2, y: s.y1, handle: { t: 2, p: 1 } },
                 { x: s.x1, y: s.y2, handle: { t: 1, p: 2 } }, { x: s.x2, y: s.y2, handle: { t: 2, p: 2 } },
                 // edge midpoints change only the length or only the height
                 { x: s.x1, y: (s.y1 + s.y2) / 2, handle: { t: 1 } }, { x: s.x2, y: (s.y1 + s.y2) / 2, handle: { t: 2 } },
                 { x: (s.x1 + s.x2) / 2, y: s.y1, handle: { p: 1 } }, { x: (s.x1 + s.x2) / 2, y: s.y2, handle: { p: 2 } }];
          return (
            <g key={s.id}>
              {d.kind === "rect" && (
                <>
                  <rect x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)}
                    fill={s.color} fillOpacity={0.14} stroke={s.color} strokeWidth={isSel ? 2 : 1} strokeDasharray={dash} pointerEvents="none" />
                  <rect x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} {...grab} {...hit} />
                </>
              )}
              {d.kind === "line" && (
                <>
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={isSel ? 3 : 2} strokeDasharray={dash} pointerEvents="none" />
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...grab} {...hit} />
                </>
              )}
              {d.kind === "hline" && (
                <>
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y1} stroke={s.color} strokeWidth={isSel ? 3 : 2} strokeDasharray={dash} pointerEvents="none" />
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y1} {...grab} {...hit} />
                  <text x={Math.max(s.x1, s.x2)} y={s.y1 - 6} textAnchor="end" fontSize={11} fontWeight={600} fill={s.color} pointerEvents="none">{s.price.toFixed(2)}</text>
                </>
              )}
              {knobs.map((k, i) => (
                <rect key={i} x={k.x - 5} y={k.y - 5} width={10} height={10} rx={2} strokeWidth={2} stroke={BLUE}
                  fill={dark ? "#131722" : "#fff"} pointerEvents="all" style={{ cursor: k.handle.t && k.handle.p ? "move" : k.handle.t ? "ew-resize" : "ns-resize" }}
                  onPointerDown={(e) => startDrag(e, base, { handle: k.handle })} {...handlers} />
              ))}
            </g>
          );
        })}
      </svg>
      {tool && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold shadow-lg">
          {hint} (Esc to cancel)
        </div>
      )}
      {selected && !tool && (
        <div className={`absolute top-3 right-20 pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-lg shadow-lg border ${
          dark ? "bg-[#1e222d] border-[#2a2e39]" : "bg-white border-slate-200"}`}>
          {DRAW_COLORS.map((c) => (
            <button key={c} title="Colour" onClick={() => props.onChange(selected.id, { ...toDrawingDraft(selected), color: c })}
              className="w-4 h-4 rounded-full" style={{ background: c, outline: c === selected.color ? `2px solid ${dark ? "#e2e8f0" : "#0f172a"}` : "none", outlineOffset: 1 }} />
          ))}
          <button title="Delete (Del)" onClick={() => { props.onDelete(selected.id); setSelectedId(null); }}
            className={`ml-1 p-1 rounded ${dark ? "text-slate-300 hover:bg-[#2a2e39]" : "text-slate-600 hover:bg-slate-100"}`}><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}
