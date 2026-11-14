import { useCallback, useEffect, useState } from "react";
import { api, type HoldingDraft, type PortfolioDetail, type PortfolioSummary } from "./api";
import { errorText } from "./useTradePlots";

/** The user's portfolios, the open one with its holdings, and the actions that change them. */
export function usePortfolio() {
  const [list, setList] = useState<PortfolioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PortfolioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshList = useCallback(async () => {
    try { setList(await api.getPortfolios()); } catch (e) { setError(errorText(e)); }
  }, []);

  useEffect(() => { void refreshList().finally(() => setLoading(false)); }, [refreshList]);

  // Open the first portfolio once the list is known, and move off one that was deleted.
  useEffect(() => {
    if (selectedId === null || !list.some((p) => p.id === selectedId)) setSelectedId(list[0]?.id ?? null);
  }, [list, selectedId]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    let cancelled = false;
    api.getPortfolio(selectedId).then((d) => { if (!cancelled) setDetail(d); }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [selectedId]);

  /** Run a call that returns the changed portfolio; show it and refresh the list's counts. */
  const change = useCallback(async (call: () => Promise<PortfolioDetail>) => {
    try {
      const d = await call();
      setError("");
      setDetail(d);
      setSelectedId(d.id);
      await refreshList();
    } catch (e) {
      setError(errorText(e));
    }
  }, [refreshList]);

  const create = (name: string) => change(() => api.createPortfolio(name));
  const createFromWatchlist = (watchlistId: number) => change(() => api.createPortfolioFromWatchlist(watchlistId));
  const rename = (name: string) => detail && change(() => api.renamePortfolio(detail.id, name));
  const addHolding = (draft: HoldingDraft) => detail && change(() => api.addHolding(detail.id, draft));
  const updateHolding = (holdingId: number, draft: HoldingDraft) => detail && change(() => api.updateHolding(detail.id, holdingId, draft));
  const deleteHolding = (holdingId: number) => detail && change(() => api.deleteHolding(detail.id, holdingId));
  const remove = async () => {
    if (!detail) return;
    try { await api.deletePortfolio(detail.id); setDetail(null); setSelectedId(null); await refreshList(); } catch (e) { setError(errorText(e)); }
  };

  return { list, selectedId, setSelectedId, detail, loading, error, create, createFromWatchlist, rename, addHolding, updateHolding, deleteHolding, remove };
}
