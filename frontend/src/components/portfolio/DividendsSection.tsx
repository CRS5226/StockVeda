import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { DividendDraft, PortfolioDividend } from "../../lib/api";
import { isoDay, shiftMonth } from "../../lib/calendar";
import type { BuyInfo } from "../../lib/dividendRules";
import { rupees } from "../../lib/formatMoney";
import { usePortfolioDividends } from "../../lib/usePortfolioDividends";
import DividendCalendar from "./DividendCalendar";
import StatCards from "./StatCards";

const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";
const todayIso = () => { const n = new Date(); return isoDay(n.getFullYear(), n.getMonth(), n.getDate()); };
const blank = (date?: string): DividendDraft => ({ symbol: "", pay_date: date ?? todayIso(), amount: 0, tds: 0 });
const prettyDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function DividendForm({ initial, buy, onSave, onCancel }: { initial: DividendDraft; buy: BuyInfo; onSave: (d: DividendDraft) => Promise<boolean>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof DividendDraft>(k: K, v: DividendDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  // a stock pays dividends only after it was bought, so the date picker starts at its first purchase
  const symbol = d.symbol.trim().toUpperCase();
  const held = buy.has(symbol), bought = buy.get(symbol) ?? null;
  const tooEarly = bought !== null && d.pay_date !== "" && d.pay_date < bought;
  const ready = symbol !== "" && held && !tooEarly && d.amount > 0 && d.pay_date !== "";
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
        <datalist id="dividend-symbols">{[...buy.keys()].map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Paid on
        <input className={input} type="date" min={bought ?? undefined} max={todayIso()} value={d.pay_date} onChange={(e) => set("pay_date", e.target.value)} />
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
      {symbol !== "" && !held && <p className="col-span-full text-xs text-red-600">{symbol} is not in this portfolio. Add it on the Stocks tab first.</p>}
      {held && bought && <p className={`col-span-full text-xs ${tooEarly ? "text-red-600" : "text-slate-500"}`}>{symbol} was bought on {bought}, so a dividend can be dated on or after that day.</p>}
    </form>
  );
}

/** What was paid on the selected day: the company, the amount and the TDS, with edit and delete. */
function DayPanel({ date, rows, onAdd, onEdit, onDelete }: { date: string | null; rows: PortfolioDividend[]; onAdd: () => void; onEdit: (id: number) => void; onDelete: (d: PortfolioDividend) => void }) {
  if (!date) return <div className="lg:w-72 text-sm text-slate-400 py-6">Click a day on the calendar to see its dividends.</div>;
  return (
    <div className="lg:w-72 shrink-0 border border-slate-200 rounded-xl p-4 flex flex-col gap-3 self-start">
      <div className="text-sm font-semibold">{prettyDate(date)}</div>
      {rows.length === 0 && <div className="text-xs text-slate-400">No dividend on this day.</div>}
      {rows.map((d) => (
        <div key={d.id} className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-emerald-900">{d.symbol}</div>
              {d.company && <div className="text-xs text-emerald-700 truncate" title={d.company}>{d.company}</div>}
            </div>
            <button title="Edit" onClick={() => onEdit(d.id)} className="p-1 rounded text-emerald-700 hover:bg-emerald-100"><Pencil size={13} /></button>
            <button title="Delete" onClick={() => onDelete(d)} className="p-1 rounded text-emerald-700 hover:bg-emerald-100"><Trash2 size={13} /></button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
            <span className="text-emerald-700">Received</span><span className="text-right font-semibold tabular-nums text-emerald-900">{rupees(d.amount)}</span>
            {d.tds > 0 && <><span className="text-emerald-700">TDS deducted</span><span className="text-right tabular-nums text-emerald-900">{rupees(d.tds)}</span>
              <span className="text-emerald-700">Before TDS</span><span className="text-right tabular-nums text-emerald-900">{rupees(d.amount + d.tds)}</span></>}
          </div>
        </div>
      ))}
      <button onClick={onAdd} className="flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
        <Plus size={13} /> Add a dividend on this day
      </button>
    </div>
  );
}

/** Dividends received on the portfolio's stocks, entered by hand and shown on a calendar. They count towards the profit and the XIRR. */
export default function DividendsSection({ portfolioId, buy, onChanged }: { portfolioId: number; buy: BuyInfo; onChanged?: () => void }) {
  const dv = usePortfolioDividends(portfolioId, onChanged);
  const list = dv.listing?.dividends ?? [];
  const summary = dv.listing?.summary;
  // null: form closed, "new": adding, a number: editing that dividend
  const [editing, setEditing] = useState<null | "new" | number>(null);
  const [formDate, setFormDate] = useState<string | undefined>(undefined);
  const now = new Date();
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);

  // Open on the month of the latest dividend, so existing entries are visible straight away.
  useEffect(() => {
    if (!dv.listing || list.length === 0) return;
    const [y, m] = list[0].pay_date.split("-").map(Number);
    setView({ year: y, month: m - 1 });
    setSelected(list[0].pay_date);
    // only when the data first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dv.listing === null]);

  const editingDividend = typeof editing === "number" ? list.find((x) => x.id === editing) : undefined;
  const dayRows = selected ? list.filter((d) => d.pay_date === selected) : [];
  const openAdd = (date?: string) => { setFormDate(date); setEditing("new"); };

  return (
    <div className="flex flex-col gap-4">
      <StatCards items={[
        { label: "Total received", value: rupees(summary?.received ?? 0), tone: "text-emerald-600" },
        { label: `This financial year (${summary?.this_fy_label ?? ""})`, value: rupees(summary?.this_fy ?? 0) },
        { label: "TDS deducted", value: rupees(summary?.tds ?? 0) },
        { label: "Payments", value: String(list.length) },
      ]} />
      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
          <h3 className="font-semibold">Dividend calendar</h3>
          {summary && summary.by_fy.length > 1 && (
            <span className="flex flex-wrap gap-2 text-xs">
              {summary.by_fy.map((b) => <span key={b.fy} className="px-2 py-1 rounded bg-slate-100 text-slate-600 tabular-nums">FY {b.fy}: {rupees(b.received)}</span>)}
            </span>
          )}
          <button onClick={() => (editing === null ? openAdd() : setEditing(null))}
            className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            {editing === null ? <><Plus size={13} /> Add dividend</> : <><X size={13} /> Close</>}
          </button>
        </div>
        {dv.error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{dv.error}</div>}
        {editing === "new" && <DividendForm key={formDate ?? "today"} initial={blank(formDate)} buy={buy} onSave={dv.add} onCancel={() => setEditing(null)} />}
        {editingDividend && <DividendForm key={editingDividend.id} initial={editingDividend} buy={buy} onSave={(d) => dv.update(editingDividend.id, d)} onCancel={() => setEditing(null)} />}
        <div className="p-4 flex flex-col lg:flex-row gap-6">
          <DividendCalendar year={view.year} month={view.month} dividends={list} selected={selected} onSelect={setSelected}
            onMonth={(delta) => setView((v) => shiftMonth(v.year, v.month, delta))} onJump={(year, month) => setView({ year, month })}
            onToday={() => { const n = new Date(); setView({ year: n.getFullYear(), month: n.getMonth() }); setSelected(todayIso()); }} />
          <DayPanel date={selected} rows={dayRows} onAdd={() => openAdd(selected ?? undefined)} onEdit={setEditing}
            onDelete={(d) => { if (window.confirm(`Delete the ${d.symbol} dividend of ${rupees(d.amount)}?`)) void dv.remove(d.id); }} />
        </div>
        {list.length === 0 && editing === null && (
          <div className="pb-6 text-center text-sm text-slate-400">No dividends yet. Add the ones you received and they show up on the calendar and in your returns.</div>
        )}
      </div>
    </div>
  );
}
