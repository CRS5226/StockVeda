import { useCallback, useEffect, useState } from "react";
import { api, type FdDraft, type FdListing } from "./api";
import { errorText } from "./useTradePlots";

/** The fixed deposits of one portfolio, with save / edit / delete that keep the list in step with the server. */
export function usePortfolioFds(portfolioId: number) {
  const [listing, setListing] = useState<FdListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError("");
    api.getFds(portfolioId).then((l) => { if (!cancelled) setListing(l); }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId]);

  /** Run a call that returns the changed list. Resolves true when it worked, so a form knows whether to close. */
  const run = useCallback(async (call: () => Promise<FdListing>): Promise<boolean> => {
    try {
      setListing(await call());
      setError("");
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, []);

  const add = (draft: FdDraft) => run(() => api.addFd(portfolioId, draft));
  const update = (id: number, draft: FdDraft) => run(() => api.updateFd(portfolioId, id, draft));
  const remove = (id: number) => run(() => api.deleteFd(portfolioId, id));

  return { listing, error, add, update, remove };
}
