import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { connectionsPath, edgeWidth, layoutOwnership, shortDate } from "../../lib/connections";
import { useSectionData } from "../../lib/useSectionData";
import SectionCard from "./SectionCard";
import StockLink from "./StockLink";

const W = 760, H = 360, BOX_W = 150, BOX_H = 30;
const clip = (text: string, n = 22) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Who holds this company and which listed companies it holds, from the shareholding filings. */
export default function OwnershipSection({ symbol }: { symbol: string }) {
  const s = useSectionData(() => api.getOwnershipGraph(symbol), [symbol]);
  const d = s.data;
  const layout = d ? layoutOwnership(d.nodes, d.edges, symbol, W, H) : null;
  return (
    <SectionCard title="Who holds it" loading={s.loading} missing={s.missing} error={s.error}
      subtitle={d?.as_of ? `Holders above 1% in the filing for ${shortDate(d.as_of)}. Listed companies are green.` : undefined}
      emptyText="No shareholding filing stored for this stock yet.">
      {d && layout && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Ownership graph">
            {layout.placed.filter((p) => p.side !== "center").map((p) => {
              const c = layout.placed.find((x) => x.side === "center")!;
              const left = p.side === "left";
              return (
                <g key={`e-${p.node.id}`}>
                  <line x1={left ? p.x + BOX_W / 2 : c.x + BOX_W / 2} y1={left ? p.y : c.y} x2={left ? c.x - BOX_W / 2 : p.x - BOX_W / 2} y2={left ? c.y : p.y}
                    stroke="#94a3b8" strokeWidth={edgeWidth(p.pct ?? 0)} strokeOpacity={0.6} />
                  <text x={(p.x + c.x) / 2} y={(p.y + c.y) / 2 - 4} textAnchor="middle" fontSize={10} fill="#475569">{p.pct?.toFixed(1)}%</text>
                </g>
              );
            })}
            {layout.placed.map((p) => {
              const center = p.side === "center";
              const box = (
                <g>
                  <rect x={p.x - BOX_W / 2} y={p.y - BOX_H / 2} width={BOX_W} height={BOX_H} rx={6}
                    fill={center ? "#2563eb" : p.node.listed ? "#ecfdf5" : "#f8fafc"}
                    stroke={center ? "#1d4ed8" : p.node.listed ? "#34d399" : "#cbd5e1"} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill={center ? "#fff" : "#1e293b"}>
                    {clip(center ? p.node.symbol ?? p.node.label : p.node.label)}
                  </text>
                </g>
              );
              return !center && p.node.symbol
                ? <Link key={p.node.id} to={connectionsPath(p.node.symbol)}>{box}</Link>
                : <g key={p.node.id}>{box}</g>;
            })}
            <text x={W * 0.14} y={14} textAnchor="middle" fontSize={10} fill="#94a3b8">HOLDERS</text>
            <text x={W * 0.86} y={14} textAnchor="middle" fontSize={10} fill="#94a3b8">COMPANIES IT HOLDS</text>
          </svg>
          {(layout.hiddenHolders > 0 || layout.hiddenHoldings > 0) && (
            <p className="text-[11px] text-slate-400">
              Showing the biggest of each: {layout.hiddenHolders} more holders and {layout.hiddenHoldings} more holdings are not drawn.
            </p>
          )}
          {layout.placed.length === 1 && <p className="text-sm text-slate-500 text-center">No holder above 1% in the latest filing.</p>}
          {d.group.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Same big promoter holder</h3>
              {d.group.map((g) => (
                <div key={g.holder} className="mb-2">
                  <div className="text-xs text-slate-600 mb-1">{g.holder} also appears in</div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.companies.map((c) => (
                      <span key={c.symbol} className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">
                        <StockLink symbol={c.symbol} name={c.name} /> <span className="text-slate-500">{c.pct.toFixed(1)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-3">{d.note}</p>
        </>
      )}
    </SectionCard>
  );
}
