import type { StockView } from "../../lib/connections";

const VIEWS: { id: StockView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "connections", label: "Connections" },
];

/** Switches the stock page between its overview and its Connections view. */
export default function StockViewSwitch({ view, onView }: { view: StockView; onView: (v: StockView) => void }) {
  return (
    <div className="ml-auto inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Stock page view">
      {VIEWS.map(({ id, label }) => (
        <button key={id} role="tab" aria-selected={view === id} onClick={() => onView(id)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            view === id ? "bg-blue-500 text-white" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
