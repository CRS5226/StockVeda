import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { FdDraft, FdFrequency, FdPayout, PortfolioFd } from "../../lib/api";
import { resultColor, rupees, signedRupees } from "../../lib/formatMoney";
import { usePortfolioFds } from "../../lib/usePortfolioFds";

const FREQUENCIES: { value: FdFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-yearly" }, { value: "yearly", label: "Yearly" },
];
const label = Object.fromEntries(FREQUENCIES.map((f) => [f.value, f.label])) as Record<FdFrequency, string>;
const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): FdDraft => ({ name: "", principal: 0, annual_rate: 0, start_date: today(), maturity_date: "", compounding: "quarterly", payout: "cumulative" });

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-slate-500">{name}{children}</label>;
}

function FdForm({ initial, onSave, onCancel }: { initial: FdDraft; onSave: (d: FdDraft) => Promise<boolean>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FdDraft>(k: K, v: FdDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const ready = d.name.trim() !== "" && d.principal > 0 && d.annual_rate >= 0 && d.start_date !== "" && d.maturity_date !== "";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await onSave({ ...d, name: d.name.trim() })) onCancel();
    setSaving(false);
  };
  return (
    <form onSubmit={submit} className="p-4 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <Field name="Name (bank or note)"><input className={input} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="SBI 3-year FD" /></Field>
      <Field name="Principal (₹)"><input className={input} type="number" min={0} step="any" value={d.principal || ""} onChange={(e) => set("principal", Number(e.target.value))} /></Field>
      <Field name="Interest rate (% a year)"><input className={input} type="number" min={0} step="any" value={d.annual_rate || ""} onChange={(e) => set("annual_rate", Number(e.target.value))} /></Field>
      <Field name="Interest is">
        <select className={input} value={d.payout} onChange={(e) => set("payout", e.target.value as FdPayout)}>
          <option value="cumulative">Added to the FD (cumulative)</option>
          {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>Paid out to my account {f.label.toLowerCase()}</option>)}
        </select>
      </Field>
      <Field name="Start date"><input className={input} type="date" value={d.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
      <Field name="Maturity date"><input className={input} type="date" value={d.maturity_date} onChange={(e) => set("maturity_date", e.target.value)} /></Field>
      {d.payout === "cumulative" ? (
        <Field name="Interest compounds">
          <select className={input} value={d.compounding} onChange={(e) => set("compounding", e.target.value as FdFrequency)}>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      ) : <div />}
      <div className="flex gap-2">
        <button disabled={!ready || saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saving ? "Saving…" : "Save FD"}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </form>
  );
}

const when = (f: PortfolioFd) => (f.status === "matured" ? "Matured" : f.status === "not_started" ? `Starts ${f.start_date}` : `${f.days_left.toLocaleString("en-IN")} days left`);
const terms = (f: PortfolioFd) => (f.payout === "cumulative" ? `Cumulative, ${label[f.compounding].toLowerCase()}` : `Paid out ${label[f.payout].toLowerCase()}`);

/** Fixed deposits of a portfolio. The current amount is worked out from the terms entered, so nothing needs updating by hand. */
export default function FdSection({ portfolioId, onChanged }: { portfolioId: number; onChanged?: () => void }) {
  const fds = usePortfolioFds(portfolioId, onChanged);
  // null: form closed, "new": adding, a number: editing that FD
  const [editing, setEditing] = useState<null | "new" | number>(null);
  const list = fds.listing?.fds ?? [];
  const totals = fds.listing?.totals;
  const editingFd = typeof editing === "number" ? list.find((f) => f.id === editing) : undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold">Fixed deposits</h3>
        {totals && list.length > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">
            {rupees(totals.principal)} invested · {rupees(totals.current_value)} today · {rupees(totals.maturity_value)} at maturity
          </span>
        )}
        <button onClick={() => setEditing(editing === null ? "new" : null)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          {editing === null ? <><Plus size={13} /> Add FD</> : <><X size={13} /> Close</>}
        </button>
      </div>
      {fds.error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fds.error}</div>}
      {editing === "new" && <FdForm initial={blank()} onSave={fds.add} onCancel={() => setEditing(null)} />}
      {editingFd && <FdForm key={editingFd.id} initial={editingFd} onSave={(d) => fds.update(editingFd.id, d)} onCancel={() => setEditing(null)} />}
      {list.length === 0 && editing === null && (
        <div className="py-8 text-center text-sm text-slate-400">No fixed deposits yet. Add one and its current value is worked out for you.</div>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-xs text-slate-500 text-left">
                {["FD", "Principal", "Rate", "Interest", "Dates", "Value today", "Interest earned", "At maturity", "", ""].map((c, i) => (
                  <th key={i} className={`px-3 py-2 font-medium ${i === 1 || i >= 5 ? "text-right" : ""}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><div className="font-semibold">{f.name}</div><div className="text-[11px] text-slate-400">{when(f)}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(f.principal)}</td>
                  <td className="px-3 py-2 tabular-nums">{f.annual_rate}%</td>
                  <td className="px-3 py-2 text-xs">{terms(f)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{f.start_date}<br />{f.maturity_date}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{rupees(f.current_value)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${resultColor(f.interest_earned)}`}>
                    {signedRupees(f.interest_earned)}
                    {f.payout !== "cumulative" && <div className="text-[11px] text-slate-400">{rupees(f.interest_received)} paid out</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(f.maturity_value)}<div className="text-[11px] text-slate-400">{signedRupees(f.maturity_interest)}</div></td>
                  <td className="px-1 py-2 text-right"><button title="Edit" onClick={() => setEditing(f.id)} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Pencil size={14} /></button></td>
                  <td className="px-2 py-2 text-right">
                    <button title="Delete" onClick={() => { if (window.confirm(`Delete "${f.name}"?`)) void fds.remove(f.id); }}
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
