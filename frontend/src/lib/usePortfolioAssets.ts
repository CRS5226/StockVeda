import { useCallback, useEffect, useState } from "react";
import { api, type AssetDraft, type AssetListing } from "./api";
import { errorText } from "./useTradePlots";

/** The other investments of one portfolio and its USD to INR rate, with save / edit / delete that follow the server. */
export function usePortfolioAssets(portfolioId: number) {
  const [listing, setListing] = useState<AssetListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError("");
    api.getAssets(portfolioId).then((l) => { if (!cancelled) setListing(l); }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId]);

  /** Run a call that returns the changed list. Resolves true when it worked, so a form knows whether to close. */
  const run = useCallback(async (call: () => Promise<AssetListing>): Promise<boolean> => {
    try {
      setListing(await call());
      setError("");
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, []);

  const add = (draft: AssetDraft) => run(() => api.addAsset(portfolioId, draft));
  const update = (id: number, draft: AssetDraft) => run(() => api.updateAsset(portfolioId, id, draft));
  const remove = (id: number) => run(() => api.deleteAsset(portfolioId, id));
  const setRate = (rate: number | null) => run(() => api.setUsdInr(portfolioId, rate));

  return { listing, error, add, update, remove, setRate };
}
