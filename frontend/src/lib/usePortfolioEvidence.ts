import { useEffect, useState } from "react";
import { api, type RuleEvidenceReport } from "./api";
import { errorText } from "./useTradePlots";

/** How each rule would have done on each stock's own history, after the given cost per side (in percent). */
export function usePortfolioEvidence(portfolioId: number, costPct: number) {
  const [report, setReport] = useState<RuleEvidenceReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // a short wait, so typing a cost does not ask the server on every keystroke
    const t = setTimeout(() => {
      api.getRuleEvidence(portfolioId, costPct)
        .then((r) => { if (!cancelled) { setReport(r); setError(""); } })
        .catch((e) => { if (!cancelled) setError(errorText(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [portfolioId, costPct]);

  return { report, error, loading };
}
