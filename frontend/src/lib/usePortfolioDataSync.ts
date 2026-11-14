import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DataCoverage, type DataSyncJob, type PortfolioFundamentalsRow } from "./api";
import { errorText } from "./useTradePlots";

/** One line for the user once a data sync has finished. */
export function describeDataSync(job: DataSyncJob): string {
  const worked = job.steps.filter((s) => s.status === "done");
  if (worked.length === 0) return "Everything was already up to date.";
  const parts = worked.map((s) => `${s.label}: ${s.updated} updated`);
  const gaps = worked.reduce((n, s) => n + s.no_data.length, 0), failed = worked.reduce((n, s) => n + s.failed.length, 0);
  return parts.join(" · ") + (gaps ? ` · ${gaps} with no data from Yahoo` : "") + (failed ? ` · ${failed} failed` : "") + ".";
}

/**
 * What is stored for the portfolio's holdings, the table built from it, and the sync that fills the gaps.
 * The sync runs on the server; this follows it until it is done and then reloads both.
 */
export function usePortfolioDataSync(portfolioId: number) {
  const [coverage, setCoverage] = useState<DataCoverage | null>(null);
  const [rows, setRows] = useState<PortfolioFundamentalsRow[]>([]);
  const [job, setJob] = useState<DataSyncJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => stop, []);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([api.getDataCoverage(portfolioId), api.getPortfolioFundamentals(portfolioId)]);
      setCoverage(c);
      setRows(f.rows);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, [portfolioId]);

  useEffect(() => { stop(); setJob(null); setBusy(false); setMessage(""); void load(); }, [load]);

  const sync = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const start = await api.startDataSync(portfolioId);
      if (start.status === "up_to_date") {
        setBusy(false);
        setMessage("Already up to date. Nothing newer is available for these holdings.");
        return;
      }
      timer.current = setInterval(async () => {
        try {
          const j = await api.getDataSync(portfolioId, start.job_id!);
          setJob(j);
          if (j.status === "done" || j.status === "error") {
            stop();
            setBusy(false);
            setMessage(j.status === "error" ? (j.error ?? "Sync failed.") : describeDataSync(j));
            await load();
          }
        } catch (e) {
          stop();
          setBusy(false);
          setError(errorText(e));
        }
      }, 1500);
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
    }
  }, [busy, portfolioId, load]);

  return { coverage, rows, job, busy, message, error, sync };
}
