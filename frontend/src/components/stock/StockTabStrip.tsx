import { TABS, type Tab } from "./stockTabs";

/** The row of tab buttons under Key Metrics. */
export default function StockTabStrip({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="flex overflow-x-auto border-b border-slate-100">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => onTab(id)}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
            tab === id ? "border-blue-500 text-blue-600 bg-blue-50/50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
          }`}>
          <Icon size={12} />{label}
        </button>
      ))}
    </div>
  );
}
