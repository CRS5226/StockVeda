import { useCallback, useEffect, useState } from "react";
import { api, type DividendDraft, type DividendListing } from "./api";
import { errorText } from "./useTradePlots";

/** The dividends received in one portfolio, with save / edit / delete that keep the list in step with the server. */
export function usePortfolioDividends(portfolioId: number, onChanged?: () => void) {
  const [listing, setListing] = useState<DividendListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError("");
    api.getDividends(portfolioId).then((l) => { if (!cancelled) setListing(l); }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId]);

  /** Run a call that returns the changed list. Resolves true when it worked, so a form knows whether to close. */
  const run = useCallback(async (call: () => Promise<DividendListing>): Promise<boolean> => {
    try {
      setListing(await call());
      setError("");
      onChanged?.();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, [onChanged]);

  const add = (draft: DividendDraft) => run(() => api.addDividend(portfolioId, draft));
  const update = (id: number, draft: DividendDraft) => run(() => api.updateDividend(portfolioId, id, draft));
  const remove = (id: number) => run(() => api.deleteDividend(portfolioId, id));

  return { listing, error, add, update, remove };
}
