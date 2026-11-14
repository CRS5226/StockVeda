import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PriceSyncJob, type PriceSyncStart } from "./api";
import { errorText } from "./useTradePlots";

export type SyncPhase = "idle" | "checking" | "running" | "done" | "up_to_date" | "error";

/** What to tell the user once a sync job has finished. */
export function describeSync(job: PriceSyncJob): string {
  const parts: string[] = [];
  if (job.updated_symbols > 0) parts.push(`${job.updated_symbols} ${job.updated_symbols === 1 ? "stock" : "stocks"} updated`);
  if (job.navs > 0) parts.push(`${job.navs} ${job.navs === 1 ? "fund" : "funds"} updated`);
  let text = parts.length ? parts.join(", ") + "." : "Already up to date: no newer prices were available.";
  if (job.no_data.length > 0) text += ` No price found for ${job.no_data.slice(0, 4).join(", ")}${job.no_data.length > 4 ? ` and ${job.no_data.length - 4} more` : ""}.`;
  return text;
}

/**
 * The portfolio's Sync button: asks the server for the latest closes and NAVs, follows the background job, and keeps
 * a short message for the user. `onUpdated` runs when new prices were stored, so the page can reload its figures.
 */
export function usePriceSync(portfolioId: number, onUpdated: () => void, startCall: (id: number) => Promise<PriceSyncStart> = api.startPriceSync) {
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => stop, []);
  useEffect(() => { stop(); setPhase("idle"); setMessage(""); }, [portfolioId]);

  const sync = useCallback(async () => {
    if (phase === "checking" || phase === "running") return;
    setPhase("checking");
    setMessage("");
    try {
      const start = await startCall(portfolioId);
      if (start.status === "up_to_date") {
        setPhase("up_to_date");
        setMessage(`Already up to date. Latest close: ${start.as_of}.`);
        return;
      }
      setPhase("running");
      setProgress({ done: start.done ?? 0, total: start.total ?? 0 });
      timer.current = setInterval(async () => {
        try {
          const job = await api.getPriceSync(portfolioId, start.job_id!);
          setProgress({ done: job.done, total: job.total });
          if (job.status === "done" || job.status === "error") {
            stop();
            if (job.status === "error") { setPhase("error"); setMessage(job.error ?? "Sync failed."); return; }
            setPhase(job.updated_symbols + job.navs > 0 ? "done" : "up_to_date");
            setMessage(describeSync(job));
            if (job.updated_symbols + job.navs > 0) onUpdated();
          }
        } catch (e) {
          stop();
          setPhase("error");
          setMessage(errorText(e));
        }
      }, 1200);
    } catch (e) {
      setPhase("error");
      setMessage(errorText(e));
    }
  }, [phase, portfolioId, onUpdated, startCall]);

  return { phase, progress, message, sync, busy: phase === "checking" || phase === "running" };
}
