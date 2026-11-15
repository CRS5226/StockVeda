import { api } from "../../lib/api";
import { decodeEntities, kindLabel, sectionElementId, shortDate } from "../../lib/connections";
import { useSectionData } from "../../lib/useSectionData";
import SectionCard from "./SectionCard";

const KIND_STYLE: Record<string, string> = {
  order: "bg-emerald-100 text-emerald-800", rating: "bg-violet-100 text-violet-800", deal: "bg-blue-100 text-blue-800",
  dividend: "bg-amber-100 text-amber-800", insolvency: "bg-red-100 text-red-800",
};

/** Order wins, ratings, deals and the next board meeting, from NSE announcements. */
export default function EventsSection({ symbol }: { symbol: string }) {
  const s = useSectionData(() => api.getCompanyEvents(symbol), [symbol]);
  const d = s.data;
  return (
    <SectionCard id={sectionElementId("events")} title="Company events" loading={s.loading} missing={s.missing} error={s.error}
      subtitle="Material NSE announcements for this company" emptyText="No events stored for this stock yet.">
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400">Order announcements</div>
              <div className="text-lg font-semibold text-slate-800">{d.order_wins_12m}</div>
              <div className="text-[10px] text-slate-400">{d.history_from ? `since ${shortDate(d.history_from)}, up to 12 months` : "no history yet"}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400">Next board meeting</div>
              <div className="text-sm font-semibold text-slate-800">{d.next_meeting ? shortDate(d.next_meeting.meeting_date) : "None announced"}</div>
              <div className="text-[10px] text-slate-400 truncate">{d.next_meeting?.purpose ?? ""}</div>
            </div>
          </div>
          {d.events.length === 0 ? <p className="text-sm text-slate-500 py-3 text-center">No material announcements in the stored period.</p> : (
            <ul className="divide-y divide-slate-100">
              {d.events.map((e, i) => (
                <li key={`${e.event_time}-${i}`} className="py-2 flex gap-2 items-start">
                  <span className={`text-[10px] rounded-full px-2 py-0.5 shrink-0 ${KIND_STYLE[e.kind] ?? "bg-slate-100 text-slate-700"}`}>{kindLabel(e.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-700 line-clamp-2">{decodeEntities(e.subject || e.category)}</div>
                    <div className="text-[10px] text-slate-400">{shortDate(e.event_time)}{e.pdf_url && <> · <a href={e.pdf_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">PDF</a></>}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400 mt-2">An order announcement gives the event and a PDF, not the order value.</p>
        </>
      )}
    </SectionCard>
  );
}
