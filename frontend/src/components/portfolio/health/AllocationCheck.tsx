import type { HealthAllocation } from "../../../lib/api";
import { pct } from "../../../lib/healthLabels";
import { rupees } from "../../../lib/formatMoney";

const STATUS: Record<HealthAllocation["status"], { text: string; cls: string }> = {
  within: { text: "Within range", cls: "bg-emerald-50 text-emerald-700" },
  over: { text: "Above target", cls: "bg-amber-50 text-amber-700" },
  under: { text: "Below target", cls: "bg-blue-50 text-blue-700" },
  no_target: { text: "No target set", cls: "bg-slate-100 text-slate-500" },
};

/** Each type's current share against the target, and the amount that would bring it back. */
export default function AllocationCheck({ rows, band }: { rows: HealthAllocation[]; band: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold">Mix by type</h3>
        <p className="text-xs text-slate-500">How far each type has drifted from the target you set (range ±{band} points).</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-xs text-slate-500 text-left">
              <th className="px-4 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium text-right">Now</th><th className="px-3 py-2 font-medium text-right">Target</th>
              <th className="px-3 py-2 font-medium text-right">Difference</th><th className="px-3 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">To reach the target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(r.value)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.current_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.target_pct === null ? "—" : pct(r.target_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.diff_pp === null ? "—" : `${r.diff_pp > 0 ? "+" : ""}${r.diff_pp.toFixed(1)} pts`}</td>
                <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span></td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                  {r.move === null || r.status === "within" ? "—" : `${r.move > 0 ? "Add" : "Reduce by"} ${rupees(Math.abs(r.move))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
