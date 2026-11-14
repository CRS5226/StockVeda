import { useCallback, useEffect, useState } from "react";
import { api, type HealthReport, type HealthSettings } from "./api";
import { errorText } from "./useTradePlots";

/** The health check of one portfolio. `refreshKey` changes whenever something in the portfolio does, which reloads it. */
export function usePortfolioHealth(portfolioId: number, refreshKey: number) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getHealth(portfolioId)
      .then((r) => { if (!cancelled) { setReport(r); setError(""); } })
      .catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId, refreshKey, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  /** Save the targets; resolves true when it worked, so the form knows whether to close. */
  const saveSettings = useCallback(async (settings: HealthSettings): Promise<boolean> => {
    try {
      await api.putHealthTargets(portfolioId, settings);
      setError("");
      setTick((n) => n + 1);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, [portfolioId]);

  return { report, error, reload, saveSettings };
}
