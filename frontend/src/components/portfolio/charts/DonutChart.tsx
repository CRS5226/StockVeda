import type { Slice } from "../../../lib/signalInsights";

interface Props {
  slices: Slice[];
  /** Big text in the middle, and a small line under it. */
  center?: string;
  sub?: string;
  size?: number;
  /** The list of slices beside the ring. Off when the caller shows its own table. */
  legend?: boolean;
}

/** A ring split into slices, with a legend of their counts. Slices with nothing in them are left out of the ring. */
export default function DonutChart({ slices, center, sub, size = 132, legend = true }: Props) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 40 40" className="w-full h-full -rotate-90 overflow-visible" role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(", ")}>
          <circle cx="20" cy="20" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="5" />
          {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
            const share = (s.value / total) * 100;
            const arc = <circle key={s.label} cx="20" cy="20" r="15.9155" fill="none" stroke={s.color} strokeWidth="5" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} />;
            offset += share;
            return arc;
          })}
        </svg>
        {center && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold tabular-nums leading-none">{center}</span>
            {sub && <span className="text-[10px] text-slate-500 mt-1 text-center leading-tight px-3">{sub}</span>}
          </div>
        )}
      </div>
      {legend && <ul className="flex flex-col gap-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-slate-600">{s.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>}
    </div>
  );
}
