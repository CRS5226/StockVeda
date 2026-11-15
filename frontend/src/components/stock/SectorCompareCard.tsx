import MacroLineChart from "../MacroLineChart";
import { SECTOR_RANGES } from "../../lib/stockFormat";
import { useState } from "react";
import type { SectorCompareData } from "../../lib/api";
import type { SectorRange } from "../../lib/stockFormat";

/** The stock against its sector index over a chosen range. */
export default function SectorCompareCard({ sym, sectorCompare }: { sym: string; sectorCompare: SectorCompareData | null }) {
  const [sectorRange, setSectorRange] = useState<SectorRange>("1Y");

// Filter sector comparison data client-side by selected range
const sectorRangeMs = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365 }[sectorRange] * 86_400_000;
const sectorCutoff = new Date(Date.now() - sectorRangeMs).toISOString().slice(0, 10);
const filteredSector = sectorCompare ? {
  ...sectorCompare,
  stock: sectorCompare.stock.filter(p => p.date >= sectorCutoff),
  sector: sectorCompare.sector.filter(p => p.date >= sectorCutoff),
} : null;

  return (
    <>
      {filteredSector && filteredSector.stock.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">
              {sym} vs {filteredSector.sector_name}
            </span>
            <div className="flex gap-1">
              {SECTOR_RANGES.map((r) => (
                <button key={r} onClick={() => setSectorRange(r)}
                  className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                    sectorRange === r ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <MacroLineChart height={150} title=""
            series={[
              { label: sym, color: "#10b981", data: filteredSector.stock.map(p => ({ date: p.date, value: p.pct })) },
              { label: filteredSector.sector_name, color: "#94a3b8", data: filteredSector.sector.map(p => ({ date: p.date, value: p.pct })) },
            ]}
          />
          <div className="flex gap-4 mt-1">
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <span className="inline-block w-3 h-0.5 bg-emerald-400 rounded" />{sym}
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <span className="inline-block w-3 h-0.5 bg-slate-400 rounded" />{filteredSector.sector_name}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
