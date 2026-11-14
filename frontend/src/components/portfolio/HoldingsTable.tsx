import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { HoldingDraft, PortfolioHolding } from "../../lib/api";
import { resultColor, rupees, signedPercent, signedRupees } from "../../lib/formatMoney";

interface Props {
  holdings: PortfolioHolding[];
  onUpdate: (id: number, draft: HoldingDraft) => void;
  onDelete: (id: number) => void;
}

const field = "w-full px-1.5 py-1 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:border-blue-400";

/** One purchase of a stock. Quantity, buy price and date are saved when the field is left. */
function Row({ h, onUpdate, onDelete }: { h: PortfolioHolding } & Pick<Props, "onUpdate" | "onDelete">) {
  const [qty, setQty] = useState(h.qty === null ? "" : String(h.qty));
  const [price, setPrice] = useState(h.buy_price === null ? "" : String(h.buy_price));
  const [date, setDate] = useState(h.buy_date ?? "");

  const save = () => {
    const q = qty.trim() === "" ? null : Number(qty), p = price.trim() === "" ? null : Number(price);
    if ((q !== null && !(q > 0)) || (p !== null && !(p > 0))) return; // ignore an invalid number; the field keeps what was typed
    const d = date || null;
    if (q === h.qty && p === h.buy_price && d === h.buy_date) return;
    onUpdate(h.id, { symbol: h.symbol, qty: q, buy_price: p, buy_date: d });
  };

  const num = (n: number | null, f: (x: number) => string) => (n === null ? <span className="text-slate-300">—</span> : f(n));
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 font-semibold"><Link to={`/stock/${h.symbol}`} className="text-blue-600 hover:underline">{h.symbol}</Link></td>
      <td className="px-2 py-1.5 w-28"><input className={field} type="number" min={0} step="any" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} onBlur={save} /></td>
      <td className="px-2 py-1.5 w-32"><input className={field} type="number" min={0} step="any" placeholder="Buy price" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={save} /></td>
      <td className="px-2 py-1.5 w-36"><input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={save} /></td>
      <td className="px-3 py-2 text-right tabular-nums">
        {num(h.last_price, rupees)}
        {h.last_date && <div className="text-[10px] text-slate-400">{h.last_date}</div>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{num(h.invested, rupees)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{num(h.value, rupees)}</td>
      <td className={`px-3 py-2 text-right tabular-nums font-medium ${resultColor(h.pnl)}`}>{num(h.pnl, signedRupees)}</td>
      <td className={`px-3 py-2 text-right tabular-nums font-medium ${resultColor(h.pnl_pct)}`}>{num(h.pnl_pct, signedPercent)}</td>
      <td className="px-2 py-2 text-right">
        <button title="Remove" onClick={() => onDelete(h.id)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
      </td>
    </tr>
  );
}

export default function HoldingsTable({ holdings, onUpdate, onDelete }: Props) {
  if (holdings.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">No stocks yet. Search a symbol above to add one.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="text-xs text-slate-500 text-left">
            {["Stock", "Quantity", "Buy price", "Buy date", "Last close", "Invested", "Value", "P&L", "P&L %", ""].map((c, i) => (
              <th key={i} className={`px-3 py-2 font-medium ${i >= 4 && i <= 8 ? "text-right" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <Row key={`${h.id}-${h.qty}-${h.buy_price}-${h.buy_date}`} h={h} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
