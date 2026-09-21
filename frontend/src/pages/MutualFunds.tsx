import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, PiggyBank, Info } from "lucide-react";
import { useMutualFundStore } from "../store/useMutualFundStore";
import type { MfScheme } from "../lib/api";

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(dec);
}

function ReturnCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  const up = value >= 0;
  return (
    <span className={up ? "text-emerald-600" : "text-red-500"}>
      {up ? "+" : ""}{fmt(value)}%
    </span>
  );
}

function planColor(plan: string): string {
  if (/direct/i.test(plan)) return "bg-emerald-50 text-emerald-700";
  if (/regular/i.test(plan)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function optionColor(option: string): string {
  if (/reinvest/i.test(option)) return "bg-indigo-50 text-indigo-700";
  if (/idcw|dividend/i.test(option)) return "bg-purple-50 text-purple-700";
  if (/growth/i.test(option)) return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

export function PlanOptionBadges({ plan, option }: { plan: string; option: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${planColor(plan)}`}>{plan}</span>
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${optionColor(option)}`}>{option}</span>
    </span>
  );
}

export default function MutualFunds() {
  const navigate = useNavigate();
  const {
    categories, categoriesLoading, loadCategories,
    bucket, category, setBucket, setCategory,
    query, setQuery,
    sortByScore, setSortByScore,
    schemes, schemesLoading, error, loadSchemes,
  } = useMutualFundStore();

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadSchemes(); }, [bucket, category, sortByScore, loadSchemes]);

  // Live-update results as the user types, debounced so we don't fire a request per keystroke.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { loadSchemes(); }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const buckets = Array.from(new Set(categories.map((c) => c.bucket)));
  const categoriesInBucket = categories.filter((c) => c.bucket === bucket);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <PiggyBank size={20} className="text-blue-600" />
        <h1 className="text-lg font-bold text-slate-800">Mutual Funds</h1>
      </div>

      <div className="flex gap-4">
        {/* Category drilldown rail */}
        <div className="w-56 shrink-0 flex flex-col gap-3">
          <div className="bg-white border border-slate-200 rounded-lg p-2">
            <div className="text-xs font-semibold text-slate-400 uppercase px-2 pt-1 pb-2">Type</div>
            <button
              onClick={() => setBucket(null)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm mb-0.5 transition-colors ${
                bucket === null ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"
              }`}>
              All Funds
            </button>
            {categoriesLoading && <div className="px-2 py-1.5 text-xs text-slate-400">Loading…</div>}
            {buckets.map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-sm mb-0.5 transition-colors ${
                  bucket === b ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"
                }`}>
                {b}
              </button>
            ))}
          </div>

          {bucket && categoriesInBucket.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg p-2">
              <div className="text-xs font-semibold text-slate-400 uppercase px-2 pt-1 pb-2">Category</div>
              <button
                onClick={() => setCategory(null)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs mb-0.5 transition-colors ${
                  category === null ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"
                }`}>
                All in {bucket}
              </button>
              {categoriesInBucket.map((c) => (
                <button
                  key={c.category}
                  onClick={() => setCategory(c.category)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs mb-0.5 transition-colors flex justify-between gap-2 ${
                    category === c.category ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"
                  }`}>
                  <span className="truncate">{c.category.replace(/^Open Ended Schemes\(|\)$/g, "")}</span>
                  <span className="text-slate-400 shrink-0">{c.scheme_count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fund table */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fund name or AMC…"
                className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-300"
              />
              {schemesLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
              )}
            </div>
            <button
              onClick={() => setSortByScore(!sortByScore)}
              title="StockVeda Score — an open, in-house risk-adjusted ranking (Sharpe + 3Y CAGR percentile within results), not an official rating"
              className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                sortByScore ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              }`}>
              Sort by Score
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-auto max-h-[calc(100vh-260px)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <th className="text-left px-3 py-2 font-medium">Fund</th>
                    <th className="text-left px-3 py-2 font-medium">AMC</th>
                    <th className="text-right px-3 py-2 font-medium">NAV</th>
                    <th className="text-right px-3 py-2 font-medium">1M</th>
                    <th className="text-right px-3 py-2 font-medium">6M</th>
                    <th className="text-right px-3 py-2 font-medium">1Y</th>
                    <th className="text-right px-3 py-2 font-medium">3Y</th>
                    <th className="text-right px-3 py-2 font-medium">5Y</th>
                    <th className="text-right px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Score <Info size={11} className="text-slate-300" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {schemesLoading && (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-400 text-sm">Loading…</td></tr>
                  )}
                  {!schemesLoading && error && (
                    <tr><td colSpan={9} className="text-center py-8 text-red-500 text-sm">{error}</td></tr>
                  )}
                  {!schemesLoading && !error && schemes.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-400 text-sm">No funds found</td></tr>
                  )}
                  {schemes.map((s: MfScheme) => (
                    <tr
                      key={s.scheme_code}
                      onClick={() => navigate(`/mutual-funds/${s.scheme_code}`)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800 truncate max-w-xs">{s.scheme_name}</div>
                        <div className="mt-0.5"><PlanOptionBadges plan={s.plan} option={s.option_type} /></div>
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs truncate max-w-[140px]">{s.amc}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-800">₹{fmt(s.latest_nav)}</td>
                      <td className="px-3 py-2 text-right"><ReturnCell value={s.return_1m} /></td>
                      <td className="px-3 py-2 text-right"><ReturnCell value={s.return_6m} /></td>
                      <td className="px-3 py-2 text-right"><ReturnCell value={s.return_1y} /></td>
                      <td className="px-3 py-2 text-right"><ReturnCell value={s.return_3y} /></td>
                      <td className="px-3 py-2 text-right"><ReturnCell value={s.return_5y} /></td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                        {s.stockveda_score != null ? s.stockveda_score.toFixed(0) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-xs text-slate-400 px-1">
            Returns and Score show once a fund's history has been fetched — open a fund to load it, then it's cached for future views. Score is an open, in-house risk-adjusted ranking (Sharpe + 3Y CAGR percentile), not an official rating.
          </div>
        </div>
      </div>
    </div>
  );
}
