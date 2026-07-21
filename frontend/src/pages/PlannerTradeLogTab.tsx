import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { api, type TradeLogEntry } from "../lib/api";
import SymbolCombobox from "../components/SymbolCombobox";

function fmt(n: number, dec = 0) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

const today = () => new Date().toISOString().slice(0, 10);

function derived(t: TradeLogEntry) {
  const riskPerShare = Math.abs(t.entry_price - t.sl_price);
  const sign = t.direction === "long" ? 1 : -1;
  if (t.exit_price == null) return { riskPerShare, rMultiple: null as number | null, pnl: null as number | null };
  const rMultiple = riskPerShare > 0 ? ((t.exit_price - t.entry_price) / riskPerShare) * sign : 0;
  const pnl = (t.exit_price - t.entry_price) * t.quantity * sign;
  return { riskPerShare, rMultiple, pnl };
}

const inputCls = "w-full text-xs border border-blue-200 bg-blue-50/60 rounded px-2 py-1.5 font-medium text-slate-800";

export default function PlannerTradeLogTab() {
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [closeExitDate, setCloseExitDate] = useState(today());
  const [closeExitPrice, setCloseExitPrice] = useState("");

  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryDate, setEntryDate] = useState(today());
  const [entryPrice, setEntryPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    setLoading(true);
    api.listTrades().then(setTrades).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const canCreate = symbol.trim() && entryPrice && slPrice && quantity && !creating;

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      await api.createTrade({
        symbol: symbol.toUpperCase(), direction, entry_date: entryDate,
        entry_price: parseFloat(entryPrice), sl_price: parseFloat(slPrice),
        quantity: parseInt(quantity, 10), notes: notes || undefined,
      });
      setSymbol(""); setEntryPrice(""); setSlPrice(""); setQuantity(""); setNotes("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const startClose = (t: TradeLogEntry) => {
    setClosingId(t.id);
    setCloseExitDate(today());
    setCloseExitPrice("");
  };

  const saveClose = async (id: number) => {
    if (!closeExitPrice) return;
    try {
      await api.updateTrade(id, { exit_date: closeExitDate, exit_price: parseFloat(closeExitPrice) });
      setClosingId(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: number) => {
    try { await api.deleteTrade(id); refresh(); } catch (e) { setError(String(e)); }
  };

  const closed = trades.filter((t) => t.exit_price != null);
  const withDerived = closed.map((t) => ({ t, d: derived(t) }));
  const winners = withDerived.filter((x) => (x.d.pnl ?? 0) > 0);
  const winRate = closed.length ? (winners.length / closed.length) * 100 : 0;
  const totalPnl = withDerived.reduce((s, x) => s + (x.d.pnl ?? 0), 0);
  const avgR = closed.length ? withDerived.reduce((s, x) => s + (x.d.rMultiple ?? 0), 0) / closed.length : 0;
  const worst = withDerived.length ? Math.min(...withDerived.map((x) => x.d.pnl ?? 0)) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Win rate", value: closed.length ? `${winRate.toFixed(1)}%` : "—", cls: winRate >= 50 ? "text-emerald-600" : "text-red-500" },
          { label: "Total P&L", value: `₹${fmt(totalPnl)}`, cls: totalPnl >= 0 ? "text-emerald-600" : "text-red-500" },
          { label: "Avg R-multiple", value: closed.length ? `${avgR.toFixed(2)}R` : "—", cls: avgR >= 0 ? "text-emerald-600" : "text-red-500" },
          { label: "Worst trade", value: closed.length ? `₹${fmt(worst)}` : "—", cls: "text-red-500" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl shadow-sm p-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</div>
            <div className={`text-lg font-bold ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-slate-400 -mt-2">{trades.length} total · {closed.length} closed · {trades.length - closed.length} open</div>

      {/* Create form */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="text-xs font-semibold text-slate-500 mb-3">Log a new trade</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><div className="text-xs text-slate-500 mb-1">Symbol</div><SymbolCombobox value={symbol} onChange={setSymbol} /></div>
          <label className="text-xs text-slate-500">
            <div className="mb-1">Direction</div>
            <select value={direction} onChange={(e) => setDirection(e.target.value as "long" | "short")} className={inputCls}>
              <option value="long">Long</option><option value="short">Short</option>
            </select>
          </label>
          <label className="text-xs text-slate-500"><div className="mb-1">Entry date</div><input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} /></label>
          <label className="text-xs text-slate-500"><div className="mb-1">Entry price</div><input type="number" step={0.05} value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className={inputCls} /></label>
          <label className="text-xs text-slate-500"><div className="mb-1">SL price</div><input type="number" step={0.05} value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className={inputCls} /></label>
          <label className="text-xs text-slate-500"><div className="mb-1">Quantity</div><input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} /></label>
          <label className="text-xs text-slate-500 col-span-2"><div className="mb-1">Notes (optional)</div><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></label>
        </div>
        <button onClick={create} disabled={!canCreate}
          className="mt-3 px-4 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400">
          {creating ? "Saving…" : "Add to log"}
        </button>
      </section>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

      {/* Trade list */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="text-xs text-slate-400 text-center py-6">Loading…</div>
        ) : trades.length === 0 ? (
          <div className="text-xs text-slate-400 italic text-center py-6 border border-dashed border-slate-200 rounded-lg">No trades logged yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="text-left py-1.5 pr-3">Symbol</th>
                <th className="text-left py-1.5 pr-3">Dir</th>
                <th className="text-left py-1.5 pr-3">Entry</th>
                <th className="text-right py-1.5 pr-3">Entry ₹</th>
                <th className="text-right py-1.5 pr-3">SL</th>
                <th className="text-right py-1.5 pr-3">Qty</th>
                <th className="text-left py-1.5 pr-3">Exit</th>
                <th className="text-right py-1.5 pr-3">Exit ₹</th>
                <th className="text-right py-1.5 pr-3">R</th>
                <th className="text-right py-1.5 pr-3">P&L</th>
                <th className="py-1.5 pr-3" />
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const d = derived(t);
                const isClosing = closingId === t.id;
                return (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 font-semibold text-slate-700">{t.symbol}</td>
                    <td className="py-1.5 pr-3 capitalize text-slate-500">{t.direction}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{t.entry_date}</td>
                    <td className="py-1.5 pr-3 text-right">{t.entry_price}</td>
                    <td className="py-1.5 pr-3 text-right text-red-400">{t.sl_price}</td>
                    <td className="py-1.5 pr-3 text-right">{t.quantity}</td>
                    <td className="py-1.5 pr-3 text-slate-500">
                      {isClosing ? (
                        <input type="date" value={closeExitDate} onChange={(e) => setCloseExitDate(e.target.value)} className="text-xs border border-slate-200 rounded px-1.5 py-0.5 w-28" />
                      ) : t.exit_date ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {isClosing ? (
                        <input type="number" step={0.05} value={closeExitPrice} onChange={(e) => setCloseExitPrice(e.target.value)} placeholder="exit price" className="text-xs border border-slate-200 rounded px-1.5 py-0.5 w-20 text-right" />
                      ) : t.exit_price ?? "—"}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-medium ${d.rMultiple == null ? "text-slate-300" : d.rMultiple >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {d.rMultiple == null ? "—" : `${d.rMultiple.toFixed(2)}R`}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-medium ${d.pnl == null ? "text-slate-300" : d.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {d.pnl == null ? "—" : `₹${fmt(d.pnl)}`}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {isClosing ? (
                        <span className="flex gap-1">
                          <button onClick={() => saveClose(t.id)} className="text-emerald-600 hover:text-emerald-700 text-[10px] font-semibold">Save</button>
                          <button onClick={() => setClosingId(null)} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
                        </span>
                      ) : (
                        <span className="flex gap-2 items-center">
                          {t.exit_price == null && (
                            <button onClick={() => startClose(t)} className="text-blue-500 hover:text-blue-700 text-[10px] font-semibold">Close</button>
                          )}
                          <button onClick={() => remove(t.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
