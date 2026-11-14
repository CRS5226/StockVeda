import { useCallback, useEffect, useState } from "react";
import { api, type ChartDrawing, type DrawingDraft } from "./api";
import { errorText } from "./useTradePlots";

/** Saved lines and rectangles of one symbol, with save / update / delete that keep the list in step with the server. */
export function useDrawings(symbol: string) {
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setDrawings([]);
    api.getDrawings(symbol).then((rows) => { if (!cancelled) setDrawings(rows); }).catch(() => { /* none shown */ });
    return () => { cancelled = true; };
  }, [symbol]);

  const create = useCallback(async (draft: DrawingDraft): Promise<ChartDrawing | null> => {
    try {
      const saved = await api.createDrawing(draft);
      setDrawings((prev) => [...prev, saved]);
      return saved;
    } catch (e) {
      console.warn("Could not save the drawing:", errorText(e));
      return null;
    }
  }, []);

  const update = useCallback(async (id: number, draft: DrawingDraft): Promise<void> => {
    // show the change at once, then confirm with the server's copy
    setDrawings((prev) => prev.map((d) => (d.id === id ? { ...d, ...draft } : d)));
    try {
      const saved = await api.updateDrawing(id, draft);
      setDrawings((prev) => prev.map((d) => (d.id === id ? saved : d)));
    } catch (e) {
      console.warn("Could not save the drawing:", errorText(e));
    }
  }, []);

  const remove = useCallback(async (id: number): Promise<void> => {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    try { await api.deleteDrawing(id); } catch (e) { console.warn("Could not delete the drawing:", errorText(e)); }
  }, []);

  return { drawings, create, update, remove };
}
