import type { StockRatios } from "../../lib/api";

/** Business description, employees and website. */
export default function AboutCompany({ ratios }: { ratios: StockRatios | null }) {
  return (
    <>
      {/* About */}
      {ratios?.description && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-400 font-medium mb-1.5">About</div>
          <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{ratios.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            {ratios.employees && <span>{ratios.employees.toLocaleString("en-IN")} employees</span>}
            {ratios.website && <a href={ratios.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{ratios.website.replace(/^https?:\/\//, "")}</a>}
          </div>
        </div>
      )}
    </>
  );
}
