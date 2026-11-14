export interface StatItem { label: string; value: string; tone?: string; hint?: string }

/** A row of summary cards (invested, value, profit ...) shared by every portfolio tab. */
export default function StatCards({ items }: { items: StatItem[] }) {
  const cols = items.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
  return (
    <div className={`grid grid-cols-2 ${cols} gap-3`}>
      {items.map((s) => (
        <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3" title={s.hint}>
          <div className="text-xs text-slate-500">{s.label}</div>
          <div className={`text-lg font-semibold tabular-nums ${s.tone ?? "text-slate-900"}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
