import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SymbolCombobox from "../components/SymbolCombobox";
import { connectionsPath } from "../lib/connections";
import { loadRecent } from "../lib/recentStocks";

const EXAMPLES = ["RELIANCE", "TCS", "TATASTEEL", "HDFCBANK", "NTPC"];

function Chip({ symbol }: { symbol: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white text-xs overflow-hidden">
      <Link to={`/stock/${encodeURIComponent(symbol)}`} className="px-3 py-1 font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-600">{symbol}</Link>
      <Link to={connectionsPath(symbol)} title={`${symbol} connections`}
        className="px-2 py-1 border-l border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600">Connections</Link>
    </span>
  );
}

/** Start page for stocks: search, the stocks you looked at last, and a few to try. */
export default function StocksHome() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [recent] = useState(loadRecent);
  return (
    <div className="max-w-3xl mx-auto space-y-6 pt-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Stocks</h1>
        <p className="text-sm text-slate-500 mt-1">
          Search any listed stock for its price chart, fundamentals, shareholding and news, and see how it connects to other stocks,
          its industry chain, its owners, where it is based and what it has announced.
        </p>
      </div>
      <div className="max-w-md">
        <SymbolCombobox value={draft} onChange={setDraft} onSelect={(s) => navigate(`/stock/${encodeURIComponent(s)}`)} placeholder="Search a stock…" />
      </div>
      {recent.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Recently viewed</h2>
          <div className="flex flex-wrap gap-2">{recent.map((s) => <Chip key={s} symbol={s} />)}</div>
        </section>
      )}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Try</h2>
        <div className="flex flex-wrap gap-2">{EXAMPLES.map((s) => <Chip key={s} symbol={s} />)}</div>
      </section>
    </div>
  );
}
