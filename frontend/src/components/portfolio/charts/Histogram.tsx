import type { Bin } from "../../../lib/signalInsights";

/** Vertical bars, one per bin, with the count above and the label below. */
export default function Histogram({ bins, height = 96 }: { bins: Bin[]; height?: number }) {
  const widest = Math.max(...bins.map((b) => b.count), 1);
  return (
    <div className="flex items-end gap-2" role="img" aria-label={bins.map((b) => `${b.label}: ${b.count}`).join(", ")}>
      {bins.map((b) => (
        <div key={b.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[11px] font-semibold tabular-nums text-slate-700">{b.count}</span>
          <div className="w-full rounded-t" style={{ height: Math.max((b.count / widest) * height, b.count > 0 ? 3 : 1), background: b.count > 0 ? b.color : "#e2e8f0" }} />
          <span className="text-[10px] text-slate-500 text-center leading-tight">{b.label}</span>
        </div>
      ))}
    </div>
  );
}
