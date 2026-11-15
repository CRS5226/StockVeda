import { useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import { useScrollToHash } from "../../lib/useScrollToHash";
import { useSectionData } from "../../lib/useSectionData";
import CorrelatedSection from "./CorrelatedSection";
import EventsSection from "./EventsSection";
import FlowChainSection from "./FlowChainSection";
import LocationWeatherSection from "./LocationWeatherSection";
import OwnershipSection from "./OwnershipSection";

/** How a stock connects to others: correlated stocks, its place in the chain, owners, location and events. */
export default function ConnectionsView({ symbol }: { symbol: string }) {
  const profile = useSectionData(() => api.getCompanyProfile(symbol), [symbol]);
  useScrollToHash(useLocation().hash, symbol);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {profile.data?.sector && <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">{profile.data.sector}</span>}
        {profile.data?.industry && <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">{profile.data.industry}</span>}
      </div>
      <CorrelatedSection symbol={symbol} />
      <FlowChainSection symbol={symbol} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <OwnershipSection symbol={symbol} />
        <div className="space-y-4">
          <LocationWeatherSection symbol={symbol} profile={profile.data} />
          <EventsSection symbol={symbol} />
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Context from public data, not investment advice. Each section says where its data comes from and what it cannot tell you.
      </p>
    </div>
  );
}
