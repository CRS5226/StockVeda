import { useEffect, useState } from "react";
import { api, type SimulationReport } from "./api";
import { errorText } from "./useTradePlots";

/** The Monte Carlo simulation of one portfolio over `months`. `refreshKey` changes whenever the portfolio does. */
export function usePortfolioSimulation(portfolioId: number, months: number, refreshKey: number) {
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getSimulation(portfolioId, months)
      .then((r) => { if (!cancelled) { setReport(r); setError(""); } })
      .catch((e) => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [portfolioId, months, refreshKey]);

  return { report, error, loading };
}
