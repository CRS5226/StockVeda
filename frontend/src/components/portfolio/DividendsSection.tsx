import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { DividendDraft } from "../../lib/api";
import { rupees } from "../../lib/formatMoney";
import { usePortfolioDividends } from "../../lib/usePortfolioDividends";

const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";
const today = () => new Date().toISOString().slice(0, 10);
const blank = (): DividendDraft => ({ symbol: "", pay_date: today(), amount: 0, tds: 0 });

function DividendForm({ initial, symbols, onSave, onCancel }: { initial: DividendDraft; symbols: string[]; onSave: (d: DividendDraft) => Promise<boolean>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof DividendDraft>(k: K, v: DividendDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const ready = d.symbol.trim() !== "" && d.amount > 0 && d.pay_date !== "";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await onSave({ ...d, symbol: d.symbol.trim().toUpperCase() })) onCancel();
    setSaving(false);
  };
  return (
    <form onSubmit={submit} className="p-4 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <label className="flex flex-col gap-1 text-xs text-slate-500">Stock
        <input className={input} list="dividend-symbols" placeholder="e.g. ITC" value={d.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} />
        <datalist id="dividend-symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Paid on
        <input className={input} type="date" max={today()} value={d.pay_date} onChange={(e) => set("pay_date", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Received in my account (₹)
        <input className={input} type="number" min={0} step="any" value={d.amount || ""} onChange={(e) => set("amount", Number(e.target.value))} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500" title="Tax the company deducted on top of what you received. Leave 0 if none.">TDS deducted (₹, optional)
        <input className={input} type="number" min={0} step="any" value={d.tds || ""} onChange={(e) => set("tds", Number(e.target.value) || 0)} />
      </label>
      <div className="flex gap-2">
        <button disabled={!ready || saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </form>
  );
}

/** Dividends received on the portfolio's stocks, entered by hand. They count towards the profit and the XIRR of the portfolio. */
export default function DividendsSection({ portfolioId, symbols, onChanged }: { portfolioId: number; symbols: string[]; onChanged?: () => void }) {
  const dv = usePortfolioDividends(portfolioId, onChanged);
  // null: form closed, "new": adding, a number: editing that dividend
  const [editing, setEditing] = useState<null | "new" | number>(null);
  const list = dv.listing?.dividends ?? [];
  const summary = dv.listing?.summary;
  const editingDividend = typeof editing === "number" ? list.find((x) => x.id === editing) : undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
        <h3 className="font-semibold">Dividends</h3>
        {summary && list.length > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">
            {rupees(summary.received)} received · {rupees(summary.this_fy)} in FY {summary.this_fy_label}
            {summary.tds > 0 && <> · {rupees(summary.tds)} TDS deducted</>}
          </span>
        )}
        <button onClick={() => setEditing(editing === null ? "new" : null)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          {editing === null ? <><Plus size={13} /> Add dividend</> : <><X size={13} /> Close</>}
        </button>
      </div>
      {dv.error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{dv.error}</div>}
      {editing === "new" && <DividendForm initial={blank()} symbols={symbols} onSave={dv.add} onCancel={() => setEditing(null)} />}
      {editingDividend && <DividendForm key={editingDividend.id} initial={editingDividend} symbols={symbols} onSave={(d) => dv.update(editingDividend.id, d)} onCancel={() => setEditing(null)} />}
      {list.length === 0 && editing === null && (
        <div className="py-8 text-center text-sm text-slate-400">No dividends yet. Add the ones you received, and they are counted in your returns.</div>
      )}
      {summary && summary.by_fy.length > 1 && (
        <div className="px-4 pt-3 flex flex-wrap gap-2 text-xs">
          {summary.by_fy.map((b) => <span key={b.fy} className="px-2 py-1 rounded bg-slate-100 text-slate-600 tabular-nums">FY {b.fy}: {rupees(b.received)}</span>)}
        </div>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-xs text-slate-500 text-left">
                <th className="px-3 py-2 font-medium">Paid on</th><th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium text-right">Received</th><th className="px-3 py-2 font-medium text-right">TDS</th><th /><th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 tabular-nums">{x.pay_date}</td>
                  <td className="px-3 py-2 font-semibold">{x.symbol}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-600">{rupees(x.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{x.tds > 0 ? rupees(x.tds) : "—"}</td>
                  <td className="px-1 py-2 text-right"><button title="Edit" onClick={() => setEditing(x.id)} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Pencil size={14} /></button></td>
                  <td className="px-2 py-2 text-right">
                    <button title="Delete" onClick={() => { if (window.confirm(`Delete the ${x.symbol} dividend of ${rupees(x.amount)}?`)) void dv.remove(x.id); }}
                      className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
