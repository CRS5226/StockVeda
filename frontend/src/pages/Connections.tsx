import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SymbolCombobox from "../components/SymbolCombobox";
import CorrelatedSection from "../components/connections/CorrelatedSection";
import EventsSection from "../components/connections/EventsSection";
import FlowChainSection from "../components/connections/FlowChainSection";
import LocationWeatherSection from "../components/connections/LocationWeatherSection";
import OwnershipSection from "../components/connections/OwnershipSection";
import { api } from "../lib/api";
import { useSectionData } from "../lib/useSectionData";

const EXAMPLES = ["RELIANCE", "TCS", "TATASTEEL", "HDFCBANK", "NTPC"];

/** Search a stock and see how it connects to others: correlated stocks, its place in the chain, owners, location and events. */
export default function Connections() {
  const { symbol: routeSymbol } = useParams();
  const symbol = routeSymbol?.toUpperCase();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(symbol ?? "");
  useEffect(() => setDraft(symbol ?? ""), [symbol]);

  const profile = useSectionData(() => (symbol ? api.getCompanyProfile(symbol) : Promise.reject(new Error("404"))), [symbol]);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!symbol) return;
    let cancelled = false;
    api.searchSymbols(symbol).then((r) => { if (!cancelled) setName(r.find((x) => x.symbol === symbol)?.name ?? null); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [symbol]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Stock connections</h1>
        <div className="w-72">
          <SymbolCombobox value={draft} onChange={setDraft} onSelect={(s) => navigate(`/connections/${encodeURIComponent(s)}`)} placeholder="Search a stock…" />
        </div>
      </div>

      {!symbol ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
          <p>Pick a stock to see which stocks move with it, where it sits between raw material and end use, who owns it, where it is based and what it has announced.</p>
          <p className="mt-3 text-slate-500">Try{" "}
            {EXAMPLES.map((s, i) => <span key={s}>{i > 0 && ", "}<Link to={`/connections/${s}`} className="text-blue-600 hover:underline">{s}</Link></span>)}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xl font-bold text-slate-900">{symbol}</span>
            {name && <span className="text-sm text-slate-500">{name}</span>}
            {profile.data?.sector && <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">{profile.data.sector}</span>}
            {profile.data?.industry && <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">{profile.data.industry}</span>}
            <Link to={`/stock/${symbol}`} className="text-xs text-blue-600 hover:underline ml-auto">Open stock page</Link>
          </div>
          <CorrelatedSection symbol={symbol} />
          <FlowChainSection symbol={symbol} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <OwnershipSection symbol={symbol} />
            <div className="space-y-4">
              <LocationWeatherSection symbol={symbol} profile={profile.data} />
              <EventsSection symbol={symbol} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Context from public data, not investment advice. Each section says where its data comes from and what it cannot tell you.
          </p>
        </>
      )}
    </div>
  );
}
