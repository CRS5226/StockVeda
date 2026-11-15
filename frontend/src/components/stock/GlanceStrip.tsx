import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { connectionsSectionPath } from "../../lib/connections";
import { buildGlance } from "../../lib/glance";
import { useSectionData } from "../../lib/useSectionData";

/**
 * A few facts about the stock, each linking to the Connections section with the detail. Each source loads on
 * its own and an item with no data is left out. The strip appears once all four have answered, so it does not
 * grow one item at a time, and it is not drawn at all when there is nothing to show.
 */
export default function GlanceStrip({ sym }: { sym: string }) {
  const profile = useSectionData(() => api.getCompanyProfile(sym), [sym]);
  const correlated = useSectionData(() => api.getCorrelated(sym, 120), [sym]);
  const events = useSectionData(() => api.getCompanyEvents(sym), [sym]);
  const ownership = useSectionData(() => api.getOwnershipGraph(sym), [sym]);
  if (profile.loading || correlated.loading || events.loading || ownership.loading) return null;

  const items = buildGlance({ profile: profile.data, correlated: correlated.data, events: events.data, ownership: ownership.data });
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-stretch gap-2" aria-label="At a glance">
      {items.map((item) => (
        <Link key={item.key} to={connectionsSectionPath(sym, item.section)}
          className="min-w-[130px] rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{item.label}</div>
          <div className="text-sm font-semibold text-slate-800 leading-snug">{item.value}</div>
          {item.detail && <div className="text-[10px] text-slate-400 truncate max-w-[220px]">{item.detail}</div>}
        </Link>
      ))}
    </div>
  );
}
