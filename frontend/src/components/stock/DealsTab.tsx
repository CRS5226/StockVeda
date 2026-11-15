import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { DEALS_DAYS, dealsCoverage, formatQty } from "../../lib/deals";
import { useSectionData } from "../../lib/useSectionData";

/** Bulk and block deals for the stock, with how far back the stored deals go. */
export default function DealsTab({ sym }: { sym: string }) {
  const navigate = useNavigate();
  const s = useSectionData(() => api.getBulkDeals([sym], DEALS_DAYS), [sym]);
  const deals = s.data?.data ?? [];
  const coverage = dealsCoverage(s.data?.date_range ?? null, new Date());

  if (s.loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (s.error || s.missing) {
    return <div className="text-xs text-red-500 py-6 text-center">Could not load bulk and block deals.</div>;
  }
  return (
    <div className="space-y-2">
      {deals.length === 0 ? (
        <div className="text-xs text-slate-400 py-6 text-center">
          No bulk or block deals found for {sym} in the last {DEALS_DAYS} days.
        </div>
      ) : (
        <>
          <p className="text-[10px] text-slate-400">Bulk &amp; block deals in the last {DEALS_DAYS} days — large institutional trades reported to NSE</p>
        <div className="max-h-[400px] overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white border-b border-slate-100">
              <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Client</th>
                <th className="text-center py-2 px-3">Action</th>
                <th className="text-right py-2 px-3">Qty</th>
                <th className="text-right py-2 px-3">Price</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => {
                return (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{d.date}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase
                        ${d.deal_type === "bulk" ? "bg-purple-50 text-purple-600" :
                          d.deal_type === "block" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                        {d.deal_type}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-[180px]">
                      <div className="text-slate-600 truncate" title={d.client_name}>{d.client_name}</div>
                      {d.client_symbol && (
                        <button onClick={() => navigate(`/stock/${d.client_symbol}`)}
                          className="text-[9px] text-blue-500 hover:underline font-semibold">{d.client_symbol} ↗</button>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold
                        ${d.buy_sell === "BUY" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                        {d.buy_sell}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-slate-600">{formatQty(d.quantity)}</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-700">₹{d.price.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      <p className="text-[10px] text-slate-400">
        {coverage.stored} {coverage.notes.join(" ")}
        {deals.length === 0 && " Deals are fetched once a day by the Sync button."}
      </p>
    </div>
  );
}
