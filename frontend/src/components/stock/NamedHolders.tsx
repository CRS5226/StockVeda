import { useState } from "react";
import { api } from "../../lib/api";
import { shortDate } from "../../lib/connections";
import { DEFAULT_VISIBLE, formatHolderPct, groupLabel, summariseHolders, summaryText, visibleHolders } from "../../lib/holders";
import { formatShares } from "../../lib/stockFormat";
import { useSectionData } from "../../lib/useSectionData";

/** The holders named in the latest shareholding filing, biggest first, under the category totals. */
export default function NamedHolders({ sym }: { sym: string }) {
  const s = useSectionData(() => api.getShareholders(sym), [sym]);
  const [expanded, setExpanded] = useState(false);
  const d = s.data;
  const rows = d ? visibleHolders(d.holders, expanded) : [];
  const summary = d ? summariseHolders(d.holders) : null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-600">Named holders</h3>
        {d && <span className="text-[10px] text-slate-400">Filing for {shortDate(d.period)}</span>}
      </div>
      {s.loading ? <p className="text-xs text-slate-400 py-4 text-center">Loading…</p>
        : s.error ? <p className="text-xs text-red-500 py-4 text-center">{s.error}</p>
        : s.missing || !d || d.holders.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No named holders stored for this stock yet. Run the shareholders sync.</p>
        ) : (
          <>
            {summary && (
              <p className="text-[11px] text-slate-500 mb-2">{summaryText(summary)}</p>
            )}
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left py-1.5 px-2 font-normal">Holder</th>
                <th className="text-left py-1.5 px-2 font-normal">Type</th>
                <th className="text-right py-1.5 px-2 font-normal">Shares</th>
                <th className="text-right py-1.5 px-2 font-normal">% as filed</th>
              </tr></thead>
              <tbody>
                {rows.map((h, i) => (
                  <tr key={`${h.holder_name}-${i}`} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-1.5 px-2 text-slate-700 max-w-[190px] truncate" title={h.holder_name}>{h.holder_name}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${h.holder_group === "promoter" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                        {groupLabel(h.holder_group)}
                      </span>
                      <span className="block text-[10px] text-slate-400 max-w-[120px] truncate" title={h.category}>{h.category}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-600 whitespace-nowrap">{formatShares(h.shares)}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-slate-700 whitespace-nowrap">{formatHolderPct(h.pct, h.shares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.holders.length > DEFAULT_VISIBLE && (
              <button onClick={() => setExpanded((e) => !e)} className="mt-2 text-xs text-blue-600 hover:underline">
                {expanded ? "Show fewer" : `Show all ${d.holders.length}`}
              </button>
            )}
            <p className="text-[10px] text-slate-400 mt-2">
              Only holders named in the filing are listed: promoters and public holders above 1%. It is not a full register of shareholders.
            </p>
          </>
        )}
    </div>
  );
}
