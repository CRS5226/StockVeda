import type { Slice } from "../../../lib/signalInsights";

/** One horizontal bar split into slices, with a count under each. */
export default function StackedBar({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div className="flex h-5 rounded-md overflow-hidden bg-slate-100" role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {total > 0 && slices.filter((s) => s.value > 0).map((s) => <div key={s.label} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {slices.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.label} <b className="tabular-nums text-slate-800">{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
