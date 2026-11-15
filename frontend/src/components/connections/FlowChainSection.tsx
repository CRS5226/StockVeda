import { api } from "../../lib/api";
import type { FlowNode, FlowRole } from "../../lib/connectionsTypes";
import { flowColumns, signedReturn } from "../../lib/connections";
import { resultColor } from "../../lib/formatMoney";
import { useSectionData } from "../../lib/useSectionData";
import SectionCard from "./SectionCard";
import StockLink from "./StockLink";

const ROLE_STYLE: Record<FlowRole, { box: string; tag: string }> = {
  current: { box: "border-blue-500 bg-blue-50", tag: "This stock's step" },
  upstream: { box: "border-amber-300 bg-amber-50", tag: "Feeds into it" },
  downstream: { box: "border-emerald-300 bg-emerald-50", tag: "It feeds into" },
  other: { box: "border-slate-200 bg-white", tag: "" },
};

function Step({ node }: { node: FlowNode }) {
  const style = ROLE_STYLE[node.role];
  return (
    <div className={`border rounded-lg p-2.5 w-44 ${style.box}`}>
      <div className="text-xs font-semibold text-slate-800 leading-tight">{node.label}</div>
      {style.tag && <div className="text-[10px] text-slate-500 mt-0.5">{style.tag}</div>}
      <ul className="mt-2 space-y-1">
        {node.stocks.length === 0 && <li className="text-[11px] text-slate-400">No stocks yet</li>}
        {node.stocks.map((s) => (
          <li key={s.symbol} className="flex justify-between items-baseline text-[11px]">
            <StockLink symbol={s.symbol} name={s.name} />
            <span className={resultColor(s.return_1m)} title="1-month return">{signedReturn(s.return_1m)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The industry chains this stock sits in: raw material on the left, end use on the right. */
export default function FlowChainSection({ symbol }: { symbol: string }) {
  const s = useSectionData(() => api.getFlowChain(symbol), [symbol]);
  const d = s.data;
  return (
    <SectionCard title="Where it sits in the chain" loading={s.loading} missing={s.missing} error={s.error}
      subtitle="Industries from raw material to end use, with the most traded stocks in each step (1-month return)"
      emptyText="No company profile for this stock yet, so its industry is unknown.">
      {d && d.chains.length === 0 && (
        <p className="text-sm text-slate-500 py-4 text-center">
          No chain covers {d.industry ?? "this industry"} yet. The map is small and hand-made.
        </p>
      )}
      {d && d.chains.map((chain) => (
        <div key={chain.id} className="mb-5 last:mb-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{chain.name}</h3>
          <div className="flex items-start gap-2 overflow-x-auto pb-2">
            {flowColumns(chain.nodes, chain.edges).map((column, i, all) => (
              <div key={i} className="flex items-start gap-2 shrink-0">
                <div className="flex flex-col gap-2">{column.map((n) => <Step key={n.id} node={n} />)}</div>
                {i < all.length - 1 && <span className="text-slate-300 text-lg self-center" aria-hidden>→</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {d && <p className="text-[11px] text-slate-400 mt-1">{d.note}</p>}
    </SectionCard>
  );
}
