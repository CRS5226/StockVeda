import { useCallback, useEffect, useState } from "react";
import { api, type MfDraft, type MfListing } from "./api";
import { errorText } from "./useTradePlots";

/** The mutual funds of one portfolio, with save / edit / delete that keep the list in step with the server. */
export function usePortfolioMf(portfolioId: number, onChanged?: () => void) {
  const [listing, setListing] = useState<MfListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError("");
    api.getMf(portfolioId).then((l) => { if (!cancelled) setListing(l); }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId]);

  /** Run a call that returns the changed list. Resolves true when it worked, so a form knows whether to close. */
  const run = useCallback(async (call: () => Promise<MfListing>): Promise<boolean> => {
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

  const add = (draft: MfDraft) => run(() => api.addMf(portfolioId, draft));
  const update = (id: number, draft: MfDraft) => run(() => api.updateMf(portfolioId, id, draft));
  const remove = (id: number) => run(() => api.deleteMf(portfolioId, id));

  return { listing, error, add, update, remove };
}
