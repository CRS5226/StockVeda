import { RefreshCw } from "lucide-react";
import type { DataCoverage, DataSyncJob } from "../../../lib/api";

interface Props { coverage: DataCoverage | null; job: DataSyncJob | null; busy: boolean; message: string; error: string; onSync: () => void }

/** What is stored for the holdings, how much of it is out of date, and the button that fetches the rest. */
export default function DataSyncPanel({ coverage, job, busy, message, error, onSync }: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
        <div>
          <h3 className="font-semibold">Data for these holdings</h3>
          <p className="text-xs text-slate-500">Fetched only for the stocks in this portfolio, from Yahoo, a little at a time.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {message && <span className="text-xs text-slate-600 max-w-md text-right" role="status">{message}</span>}
          <button onClick={onSync} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> {busy ? "Syncing…" : "Sync data"}
          </button>
        </div>
      </div>
      {error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="p-4 grid gap-3 md:grid-cols-3">
        {(coverage?.datasets ?? []).map((d) => {
          const step = job?.steps.find((s) => s.key === d.key);
          const running = busy && step && step.status !== "skipped";
          return (
            <div key={d.key} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{d.label}</span>
                <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${d.stale === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {d.stale === 0 ? "Up to date" : `${d.stale} to fetch`}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{d.stored} of {d.total} stored · {d.applies_to}{d.newest ? ` · newest ${d.newest.slice(0, 10)}` : ""}</div>
              {running && step && (
                <div className="mt-2">
                  <div className="h-1.5 rounded bg-slate-100 overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{ width: `${step.total ? (step.done / step.total) * 100 : 0}%` }} /></div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    {step.status === "pending" ? "Waiting…" : `${step.done} of ${step.total}`}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!coverage && !error && <div className="text-sm text-slate-400">Checking what is stored…</div>}
      </div>
    </div>
  );
}
