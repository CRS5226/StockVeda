import { useState } from "react";
import { api } from "../../lib/api";
import type { CorrelatedEntry } from "../../lib/connectionsTypes";
import { correlationLabel, sectionElementId, signedReturn } from "../../lib/connections";
import { resultColor } from "../../lib/formatMoney";
import { useSectionData } from "../../lib/useSectionData";
import SectionCard from "./SectionCard";
import StockLink from "./StockLink";

const WINDOWS = [60, 120, 250];

function Table({ title, rows, empty }: { title: string; rows: CorrelatedEntry[]; empty: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-slate-400">{empty}</p> : (
        <table className="w-full text-xs">
          <thead><tr className="text-slate-400 text-left">
            <th className="font-normal pb-1">Stock</th><th className="font-normal pb-1">Corr.</th>
            <th className="font-normal pb-1 pr-2 text-right">1M</th><th className="font-normal pb-1 pr-2 text-right">3M</th>
            <th className="font-normal pb-1 text-right">PE</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t border-slate-100">
                <td className="py-1.5 pr-2"><StockLink symbol={r.symbol} name={r.name} />
                  <span className="block text-[10px] text-slate-400 truncate max-w-[150px]">{r.name ?? r.industry ?? ""}</span></td>
                <td className="py-1.5 pr-3 text-slate-600 whitespace-nowrap" title={correlationLabel(r.correlation)}>
                  {r.correlation === null ? "–" : r.correlation.toFixed(2)}</td>
                <td className={`py-1.5 pr-2 text-right whitespace-nowrap ${resultColor(r.return_1m)}`}>{signedReturn(r.return_1m)}</td>
                <td className={`py-1.5 pr-2 text-right whitespace-nowrap ${resultColor(r.return_3m)}`}>{signedReturn(r.return_3m)}</td>
                <td className="py-1.5 text-right text-slate-600 whitespace-nowrap">{r.pe === null ? "–" : r.pe.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Stocks that move with, or against, this one, and its same-industry peers. */
export default function CorrelatedSection({ symbol }: { symbol: string }) {
  const [days, setDays] = useState(120);
  const s = useSectionData(() => api.getCorrelated(symbol, days), [symbol, days]);
  const d = s.data;
  return (
    <SectionCard id={sectionElementId("correlated")} title="Stocks that move together" loading={s.loading} missing={s.missing} error={s.error}
      subtitle={d ? `Daily returns over the last ${d.window} trading days, up to ${d.as_of.slice(0, 10)}${d.beta_vs_nifty !== null ? ` · beta vs NIFTY ${d.beta_vs_nifty}` : ""}` : undefined}
      emptyText="No price data for this stock yet.">
      <div className="flex gap-1.5 mb-3">
        {WINDOWS.map((w) => (
          <button key={w} onClick={() => setDays(w)}
            className={`px-2.5 py-1 text-xs rounded-md border ${w === days ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {w} days
          </button>
        ))}
      </div>
      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Table title="Move together" rows={d.positive} empty="No stock has enough overlapping history." />
          <Table title="Move the opposite way" rows={d.negative} empty="No inversely correlated stock found." />
          <Table title={d.profile?.industry ? `Peers · ${d.profile.industry}` : "Peers"} rows={d.peers}
            empty={d.profile ? "No peers with enough history." : "No company profile yet, so no peers."} />
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-3">
        Hover a correlation for its strength in words. Correlation describes the past and does not mean one stock causes another. Stocks with short price history are left out.
      </p>
    </SectionCard>
  );
}
