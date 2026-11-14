import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartDrawing, DrawingDraft, PlotDraft, PlottedTrade } from "./api";
import { toDrawingDraft } from "./drawings";
import { toDraft } from "./tradePlot";

export type LayerRef = { type: "trade" | "drawing"; id: number };

/** One deleted item, with what is needed to put it back. `id` is its current id on the server, or null while it is deleted. */
type Entry =
  | { type: "trade"; draft: PlotDraft; id: number | null }
  | { type: "drawing"; draft: DrawingDraft; id: number | null };

interface Source<T, D> {
  items: T[];
  create: (draft: D) => Promise<{ id: number } | null>;
  remove: (id: number) => Promise<void>;
}

/**
 * Deleting plotted items (trade boxes, lines, rectangles) with undo and redo. Each delete, including "delete all",
 * is one step. Undo saves the items again (they get new ids); redo deletes them again. A new delete drops the redo steps.
 */
export function useLayerHistory(symbol: string, trades: Source<PlottedTrade, PlotDraft>, drawings: Source<ChartDrawing, DrawingDraft>) {
  const undoSteps = useRef<Entry[][]>([]);
  const redoSteps = useRef<Entry[][]>([]);
  const working = useRef(false);
  const [, rerender] = useState(0);
  const latest = useRef({ trades, drawings });
  latest.current = { trades, drawings };

  useEffect(() => { undoSteps.current = []; redoSteps.current = []; rerender((n) => n + 1); }, [symbol]);

  const deleteLayers = useCallback((layers: LayerRef[]) => {
    const { trades: t, drawings: d } = latest.current;
    const step: Entry[] = [];
    for (const l of layers) {
      if (l.type === "trade") {
        const p = t.items.find((x) => x.id === l.id);
        if (p) { step.push({ type: "trade", draft: toDraft(p), id: p.id }); void t.remove(p.id); }
      } else {
        const x = d.items.find((y) => y.id === l.id);
        if (x) { step.push({ type: "drawing", draft: toDrawingDraft(x), id: x.id }); void d.remove(x.id); }
      }
    }
    if (step.length === 0) return;
    undoSteps.current.push(step);
    redoSteps.current = [];
    rerender((n) => n + 1);
  }, []);

  const undo = useCallback(async () => {
    const step = undoSteps.current.pop();
    if (!step || working.current) { if (step) undoSteps.current.push(step); return; }
    working.current = true;
    const { trades: t, drawings: d } = latest.current;
    for (const e of step) {
      const saved = e.type === "trade" ? await t.create(e.draft) : await d.create(e.draft);
      e.id = saved ? saved.id : null;
    }
    redoSteps.current.push(step);
    working.current = false;
    rerender((n) => n + 1);
  }, []);

  const redo = useCallback(async () => {
    const step = redoSteps.current.pop();
    if (!step || working.current) { if (step) redoSteps.current.push(step); return; }
    working.current = true;
    const { trades: t, drawings: d } = latest.current;
    for (const e of step) {
      if (e.id === null) continue;
      if (e.type === "trade") await t.remove(e.id); else await d.remove(e.id);
      e.id = null;
    }
    undoSteps.current.push(step);
    working.current = false;
    rerender((n) => n + 1);
  }, []);

  return { deleteLayers, undo, redo, canUndo: undoSteps.current.length > 0, canRedo: redoSteps.current.length > 0 };
}
