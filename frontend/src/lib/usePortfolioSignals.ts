import { useCallback, useEffect, useState } from "react";
import { api, type SignalSettings, type SignalsReport } from "./api";
import { errorText } from "./useTradePlots";

/** The rule scoreboard of one portfolio, and saving the thresholds its zones use. */
export function usePortfolioSignals(portfolioId: number, refreshKey: number) {
  const [report, setReport] = useState<SignalsReport | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getSignals(portfolioId)
      .then((r) => { if (!cancelled) { setReport(r); setError(""); } })
      .catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId, refreshKey, tick]);

  /** Save the thresholds; resolves true when it worked, so the form knows whether to close. */
  const saveSettings = useCallback(async (settings: SignalSettings): Promise<boolean> => {
    try {
      await api.putSignalSettings(portfolioId, settings);
      setError("");
      setTick((n) => n + 1);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, [portfolioId]);

  return { report, error, saveSettings };
}
