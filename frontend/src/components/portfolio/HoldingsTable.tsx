import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from "lucide-react";
import type { HoldingDraft, PortfolioHolding } from "../../lib/api";
import { nextSort, sortRows, type SortState } from "../../lib/sortRows";
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
    onUpdate(h.id, { symbol: h.symbol, qty: q, buy_price: p, buy_date: d, kind: h.kind_override });
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
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{num(h.invested, rupees)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{num(h.value, rupees)}</td>
      <td className={`px-5 py-2 min-w-[120px] text-right tabular-nums font-medium whitespace-nowrap ${resultColor(h.pnl)}`}>{num(h.pnl, signedRupees)}</td>
      <td className={`px-5 py-2 min-w-[110px] text-right tabular-nums font-medium whitespace-nowrap ${resultColor(h.pnl_pct)}`}>{num(h.pnl_pct, signedPercent)}</td>
      <td className="px-2 py-2 text-right">
        <button title="Remove" onClick={() => onDelete(h.id)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
      </td>
    </tr>
  );
}

type SortKey = "symbol" | "qty" | "buy_price" | "buy_date" | "last_price" | "invested" | "value" | "pnl" | "pnl_pct";
const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "symbol", label: "Stock" }, { key: "qty", label: "Quantity" }, { key: "buy_price", label: "Buy price" }, { key: "buy_date", label: "Buy date" },
  { key: "last_price", label: "Last close", right: true }, { key: "invested", label: "Invested", right: true }, { key: "value", label: "Value", right: true },
  { key: "pnl", label: "P&L", right: true }, { key: "pnl_pct", label: "P&L %", right: true },
];

/** Column title that sorts the table: a small arrow shows the direction, and a click steps through ascending, descending and off. */
function SortHeader({ col, sort, onSort }: { col: (typeof COLUMNS)[number]; sort: SortState<SortKey> | null; onSort: (k: SortKey) => void }) {
  const active = sort?.key === col.key;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`${col.key === "pnl" || col.key === "pnl_pct" ? "px-5" : "px-3"} py-2 font-medium ${col.right ? "text-right" : ""}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(col.key)} title="Sort"
        className={`inline-flex items-center gap-1 hover:text-slate-800 ${active ? "text-blue-600" : ""} ${col.right ? "flex-row-reverse" : ""}`}>
        {col.label}<Icon size={12} className={active ? "" : "opacity-40"} />
      </button>
    </th>
  );
}

export default function HoldingsTable({ holdings, onUpdate, onDelete }: Props) {
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const rows = useMemo(() => (sort ? sortRows(holdings, sort.key, sort.dir) : holdings), [holdings, sort]);
  if (holdings.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">No stocks yet. Search a symbol above to add one.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="text-xs text-slate-500 text-left">
            {COLUMNS.map((c) => <SortHeader key={c.key} col={c} sort={sort} onSort={(k) => setSort((cur) => nextSort(cur, k))} />)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <Row key={`${h.id}-${h.qty}-${h.buy_price}-${h.buy_date}`} h={h} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
