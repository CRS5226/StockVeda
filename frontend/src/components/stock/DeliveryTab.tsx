import { RefreshCw } from "lucide-react";
import MacroLineChart from "../MacroLineChart";
import type { Delivery } from "../../lib/api";
import type { Tab } from "./stockTabs";

/** Delivery percentage over time, or a prompt to sync the NSE data. */
export default function DeliveryTab({ delivery, syncingTab, syncTabData }: {
  delivery: Delivery[];
  syncingTab: Tab | null;
  syncTabData: (source: string, forTab: Tab) => void;
}) {
  return (
    syncingTab === "delivery" ? (
      <div className="flex flex-col items-center gap-2 py-10 px-4">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-xs font-medium text-slate-600">Sync started — running in the background</div>
        <div className="text-xs text-slate-400 text-center max-w-sm">
          Downloading about a year of NSE bhavcopy (price + delivery, one file per trading day).
          The whole first sync can take ten minutes or more, but the chart appears here
          after the first few weeks arrive. You can keep using the app, or just refresh shortly.
        </div>
      </div>
    ) : delivery.length === 0 ? (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="text-xs text-slate-400 text-center">
          Delivery data comes from NSE bhavcopy — not available via yfinance.
          The first sync downloads about a year of history (ten minutes or more).
        </div>
        <button onClick={() => syncTabData("bhavcopy", "delivery")} disabled={syncingTab !== null}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 text-slate-600 transition-all disabled:opacity-50">
          <RefreshCw size={11} /> Sync bhavcopy
        </button>
      </div>
    ) : (
      <MacroLineChart title="Delivery %" height={160}
        series={[{ label: "Delivery %", color: "#10b981", data: delivery.map((d) => ({ date: d.date, value: d.delivery_pct })) }]} />
    )
  );
}
