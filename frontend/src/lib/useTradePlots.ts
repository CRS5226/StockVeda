import { useCallback, useEffect, useState } from "react";
import { api, type PlotDraft, type PlottedTrade } from "./api";

/** The message of an API error: the server's `detail` when it sent one. */
function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : "Something went wrong.";
  const body = raw.replace(/^\d+:\s*/, "");
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  } catch { /* not JSON */ }
  return body;
}

const byEntry = (a: PlottedTrade, b: PlottedTrade) => a.entry_time.localeCompare(b.entry_time) || a.id - b.id;

/** Saved trade boxes of one symbol, with save / update / delete that keep the list in step with the server. */
export function useTradePlots(symbol: string) {
  const [plots, setPlots] = useState<PlottedTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getTradePlots(symbol)
      .then((rows) => { if (!cancelled) setPlots(rows); })
      .catch((e) => { if (!cancelled) { setPlots([]); setError(errorText(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  const create = useCallback(async (draft: PlotDraft): Promise<PlottedTrade | null> => {
    try {
      const saved = await api.createTradePlot(draft);
      setError("");
      setPlots((prev) => [...prev, saved].sort(byEntry));
      return saved;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  }, []);

  const update = useCallback(async (id: number, draft: PlotDraft): Promise<void> => {
    try {
      const saved = await api.updateTradePlot(id, draft);
      setError("");
      setPlots((prev) => prev.map((p) => (p.id === id ? saved : p)).sort(byEntry));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  const remove = useCallback(async (id: number): Promise<void> => {
    try {
      await api.deleteTradePlot(id);
      setError("");
      setPlots((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  return { plots, loading, error, create, update, remove };
}
