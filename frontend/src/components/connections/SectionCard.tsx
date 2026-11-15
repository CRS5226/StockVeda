import type { ReactNode } from "react";

/** A titled card for one section of the Connections page, with the loading, no-data and error states built in. */
export default function SectionCard({ id, title, subtitle, loading, missing, error, emptyText, children }: {
  /** Anchor id, so a link can open the Connections view at this section. */
  id?: string;
  title: string;
  subtitle?: string;
  loading: boolean;
  missing: boolean;
  error: string;
  /** Shown when the server has no data for this stock yet. */
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm scroll-mt-20">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {loading ? <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
        : error ? <p className="text-sm text-red-600 py-6 text-center">{error}</p>
        : missing ? <p className="text-sm text-slate-500 py-6 text-center">{emptyText}</p>
        : children}
    </section>
  );
}
