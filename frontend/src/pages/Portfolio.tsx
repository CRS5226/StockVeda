import { useEffect, useState } from "react";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import HoldingsTable from "../components/portfolio/HoldingsTable";
import SymbolCombobox from "../components/SymbolCombobox";
import { api, type Watchlist } from "../lib/api";
import { resultColor, rupees, signedPercent, signedRupees } from "../lib/formatMoney";
import { usePortfolio } from "../lib/usePortfolio";

const button = "px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40";
const input = "px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}

/** Portfolios of stocks the user holds: start one from a watchlist, fill in quantity and buy price, see profit and loss. */
export default function Portfolio() {
  const p = usePortfolio();
  const [newName, setNewName] = useState("");
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [watchlistId, setWatchlistId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => { api.getWatchlists().then(setWatchlists).catch(() => { /* none offered */ }); }, []);

  const totals = p.detail?.totals;
  const add = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    void p.addHolding({ symbol: s, qty: null, buy_price: null, buy_date: null });
    setSymbol("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Briefcase size={20} className="text-blue-600" />
        <h1 className="text-xl font-bold">Portfolio</h1>
      </div>
      {p.error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{p.error}</div>}

      <div className="flex gap-4 items-start">
        <aside className="w-64 shrink-0 flex flex-col gap-3">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {p.list.length === 0 && <div className="p-4 text-xs text-slate-400">{p.loading ? "Loading…" : "No portfolios yet."}</div>}
            {p.list.map((x) => (
              <button key={x.id} onClick={() => p.setSelectedId(x.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left border-b border-slate-100 last:border-0 ${
                  x.id === p.selectedId ? "bg-blue-50 text-blue-700 font-semibold" : "hover:bg-slate-50"}`}>
                <span className="truncate">{x.name}</span><span className="text-xs text-slate-400">{x.holdings}</span>
              </button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { void p.create(newName.trim()); setNewName(""); } }}>
            <input className={`${input} flex-1 min-w-0`} placeholder="New portfolio name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className={button} disabled={!newName.trim()}><Plus size={14} /></button>
          </form>
          <div className="flex gap-2">
            <select className={`${input} flex-1 min-w-0`} value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)}>
              <option value="">From a watchlist…</option>
              {watchlists.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.symbols.length})</option>)}
            </select>
            <button className={button} disabled={!watchlistId} onClick={() => { void p.createFromWatchlist(Number(watchlistId)); setWatchlistId(""); }}>Save</button>
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col gap-4">
          {!p.detail && <div className="py-16 text-center text-sm text-slate-400">Create a portfolio, or save a watchlist as one, to start.</div>}
          {p.detail && totals && (
            <>
              <div className="flex items-center gap-2">
                {renaming === null ? (
                  <h2 className="text-lg font-semibold cursor-text" title="Click to rename" onClick={() => setRenaming(p.detail!.name)}>{p.detail.name}</h2>
                ) : (
                  <input autoFocus className={`${input} text-lg font-semibold`} value={renaming} onChange={(e) => setRenaming(e.target.value)}
                    onBlur={() => { if (renaming.trim() && renaming.trim() !== p.detail!.name) void p.rename(renaming.trim()); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} />
                )}
                <button title="Delete this portfolio" className="ml-auto p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"
                  onClick={() => { if (window.confirm(`Delete the portfolio "${p.detail!.name}" and its holdings?`)) void p.remove(); }}><Trash2 size={15} /></button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Invested" value={rupees(totals.invested)} />
                <Stat label="Current value" value={rupees(totals.value)} />
                <Stat label="Profit / loss" value={signedRupees(totals.pnl)} tone={resultColor(totals.pnl)} />
                <Stat label="Return" value={totals.pnl_pct === null ? "—" : signedPercent(totals.pnl_pct)} tone={resultColor(totals.pnl_pct)} />
              </div>
              {totals.incomplete > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {totals.incomplete} {totals.incomplete === 1 ? "stock needs" : "stocks need"} a quantity and buy price (and a stored daily close) before {totals.incomplete === 1 ? "it counts" : "they count"} in the totals.
                </div>
              )}
              <div className="bg-white border border-slate-200 rounded-xl">
                <div className="p-3 border-b border-slate-100 w-72">
                  <SymbolCombobox value={symbol} onChange={setSymbol} onSelect={add} placeholder="Add a stock…" />
                </div>
                <HoldingsTable holdings={p.detail.holdings} onUpdate={(id, d) => void p.updateHolding(id, d)} onDelete={(id) => void p.deleteHolding(id)} />
              </div>
              <p className="text-xs text-slate-400">Values use the latest daily close stored in the database. Sync data to update them.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
