import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, type MfDraft, type MfKind, type MfScheme, type PortfolioMf } from "../../lib/api";
import StatCards from "./StatCards";
import { resultColor, rupees, signedPercent, signedRupees } from "../../lib/formatMoney";
import { usePortfolioMf } from "../../lib/usePortfolioMf";

const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";
const today = () => new Date().toISOString().slice(0, 10);
const planLabel = (plan: string | null, option: string | null) => [plan?.replace(/ Plan$/i, ""), option?.replace(/ Option$/i, "")].filter(Boolean).join(" • ");

type SortKey = "returns_pct" | "current_value" | "scheme_name";
const SORTS: { key: SortKey; label: string }[] = [{ key: "returns_pct", label: "Returns %" }, { key: "current_value", label: "Current value" }, { key: "scheme_name", label: "Name" }];

/** Search the scheme list as you type and pick one. */
function SchemePicker({ picked, onPick }: { picked: { code: string; name: string } | null; onPick: (s: MfScheme) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MfScheme[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setResults([]); setStatus(""); return; }
    timer.current = setTimeout(() => {
      api.getMfSchemes({ q: q.trim(), limit: 12 })
        .then((r) => { setResults(r); setOpen(true); setStatus(r.length === 0 ? "No scheme found. Sync the scheme list from the Mutual Funds page if it is empty." : ""); })
        .catch(() => setStatus("Could not search the scheme list."));
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  return (
    <div className="relative col-span-2">
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Mutual fund
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input className={`${input} pl-8`} placeholder={picked ? picked.name : "Search by name, e.g. Parag Parikh Flexi Cap"} value={q}
            onChange={(e) => setQ(e.target.value)} onFocus={() => results.length > 0 && setOpen(true)} />
        </div>
      </label>
      {picked && <div className="mt-1 text-xs font-medium text-blue-700 truncate">Selected: {picked.name}</div>}
      {status && <div className="mt-1 text-xs text-slate-400">{status}</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 left-0 right-0 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {results.map((s) => (
            <li key={s.scheme_code}>
              <button type="button" onClick={() => { onPick(s); setOpen(false); setQ(""); }} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                <div className="text-sm font-medium text-slate-800">{s.scheme_name}</div>
                <div className="text-xs text-slate-400">{planLabel(s.plan, s.option_type)} · NAV {s.latest_nav.toFixed(2)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MfForm({ initial, name, onSave, onCancel }: { initial: MfDraft; name: string; onSave: (d: MfDraft) => Promise<boolean>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [picked, setPicked] = useState<{ code: string; name: string } | null>(initial.scheme_code ? { code: initial.scheme_code, name } : null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof MfDraft>(k: K, v: MfDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const ready = d.scheme_code !== "" && d.amount > 0 && d.start_date !== "";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await onSave(d)) onCancel();
    setSaving(false);
  };
  return (
    <form onSubmit={submit} className="p-4 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 items-start">
      <SchemePicker picked={picked} onPick={(s) => { setPicked({ code: s.scheme_code, name: s.scheme_name }); set("scheme_code", s.scheme_code); }} />
      <label className="flex flex-col gap-1 text-xs text-slate-500">I invest through
        <select className={input} value={d.kind} onChange={(e) => { const k = e.target.value as MfKind; setD((p) => ({ ...p, kind: k, end_date: k === "sip" ? p.end_date : null })); }}>
          <option value="sip">A monthly SIP</option><option value="lumpsum">A lump sum</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">{d.kind === "sip" ? "Amount each month (₹)" : "Amount (₹)"}
        <input className={input} type="number" min={0} step="any" value={d.amount || ""} onChange={(e) => set("amount", Number(e.target.value))} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">{d.kind === "sip" ? "First instalment" : "Invested on"}
        <input className={input} type="date" max={today()} value={d.start_date} onChange={(e) => set("start_date", e.target.value)} />
      </label>
      {d.kind === "sip" ? (
        <label className="flex flex-col gap-1 text-xs text-slate-500">SIP stopped on (leave empty if running)
          <input className={input} type="date" value={d.end_date ?? ""} onChange={(e) => set("end_date", e.target.value || null)} />
        </label>
      ) : <div />}
      <div className="flex gap-2 md:col-start-4 pt-5">
        <button disabled={!ready || saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </form>
  );
}

const sortFn = (key: SortKey) => (a: PortfolioMf, b: PortfolioMf) =>
  key === "scheme_name" ? a.scheme_name.localeCompare(b.scheme_name) : (b[key] ?? -Infinity) - (a[key] ?? -Infinity);

/** One fund as a card: its plan, SIP status, current value and returns. */
function Card({ h, onEdit, onDelete }: { h: PortfolioMf; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500">{planLabel(h.plan, h.option_type) || "Mutual fund"}</div>
          <div className="font-semibold text-slate-900 leading-snug">{h.scheme_name}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {h.active_sip && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">Active SIP</span>}
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {h.kind === "sip" ? `${rupees(h.amount)} / month${h.installments ? ` · ${h.installments} paid` : ""}` : `Lump sum ${rupees(h.amount)}`}
            </span>
          </div>
        </div>
        <button title="Edit" onClick={onEdit} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Pencil size={14} /></button>
        <button title="Delete" onClick={onDelete} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
      </div>
      {h.current_value === null ? (
        <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">No NAV stored for this date range yet, so there is no value to show.</div>
      ) : (
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <div><div className="text-xs text-slate-500">Current value</div><div className="text-lg font-semibold tabular-nums">{rupees(h.current_value)}</div></div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Returns</div>
            <div className={`text-lg font-semibold tabular-nums ${resultColor(h.returns)}`}>
              {signedRupees(h.returns ?? 0)} <span className="text-sm">({signedPercent(h.returns_pct ?? 0)})</span>
            </div>
          </div>
          <div className="text-xs text-slate-500">Invested <span className="text-slate-800 font-medium tabular-nums">{rupees(h.invested ?? 0)}</span></div>
          <div className="text-xs text-slate-500 text-right">XIRR <span className={`font-medium tabular-nums ${resultColor(h.xirr_pct)}`}>{h.xirr_pct === null ? "—" : signedPercent(h.xirr_pct)}</span></div>
        </div>
      )}
    </div>
  );
}

/** SIPs and lump sums in mutual funds. Units come from the stored NAV history, so the value and XIRR work themselves out. */
export default function MfSection({ portfolioId, onChanged }: { portfolioId: number; onChanged?: () => void }) {
  const mf = usePortfolioMf(portfolioId, onChanged);
  // null: form closed, "new": adding, a number: editing that holding
  const [editing, setEditing] = useState<null | "new" | number>(null);
  const [sort, setSort] = useState<SortKey>("returns_pct");
  const list = [...(mf.listing?.holdings ?? [])].sort(sortFn(sort));
  const totals = mf.listing?.totals;
  const editingHolding = typeof editing === "number" ? list.find((x) => x.id === editing) : undefined;
  const blank: MfDraft = { scheme_code: "", kind: "sip", amount: 0, start_date: "", end_date: null };

  return (
    <div className="flex flex-col gap-4">
      <StatCards items={[
        { label: "Invested", value: rupees(totals?.invested ?? 0) },
        { label: "Current value", value: rupees(totals?.current_value ?? 0) },
        { label: "Profit / loss", value: signedRupees(totals?.returns ?? 0), tone: resultColor(totals?.returns ?? 0) },
        { label: "Return", value: totals?.returns_pct == null ? "—" : signedPercent(totals.returns_pct), tone: resultColor(totals?.returns_pct ?? null) },
        { label: "XIRR", value: totals?.xirr_pct == null ? "—" : signedPercent(totals.xirr_pct), tone: resultColor(totals?.xirr_pct ?? null), hint: "Annual return worked out from the dated SIP instalments" },
      ]} />
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
        <h3 className="font-semibold">Mutual funds <span className="text-slate-400 font-normal">({list.length})</span></h3>
        <div className="ml-auto flex items-center gap-3">
          {list.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">Sort by
              <select className="px-1.5 py-1 text-xs border border-slate-200 rounded bg-white" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          )}
          <button onClick={() => setEditing(editing === null ? "new" : null)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            {editing === null ? <><Plus size={13} /> Add fund</> : <><X size={13} /> Close</>}
          </button>
        </div>
      </div>
      {mf.error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{mf.error}</div>}
      {editing === "new" && <MfForm initial={blank} name="" onSave={mf.add} onCancel={() => setEditing(null)} />}
      {editingHolding && (
        <MfForm key={editingHolding.id} initial={{ scheme_code: editingHolding.scheme_code, kind: editingHolding.kind, amount: editingHolding.amount, start_date: editingHolding.start_date, end_date: editingHolding.end_date }}
          name={editingHolding.scheme_name} onSave={(d) => mf.update(editingHolding.id, d)} onCancel={() => setEditing(null)} />
      )}
      {list.length === 0 && editing === null && (
        <div className="py-8 text-center text-sm text-slate-400">No mutual funds yet. Add a SIP or a lump sum and its value and XIRR are worked out from the NAV history.</div>
      )}
      {list.length > 0 && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((h) => (
            <Card key={h.id} h={h} onEdit={() => setEditing(h.id)} onDelete={() => { if (window.confirm(`Delete "${h.scheme_name}"?`)) void mf.remove(h.id); }} />
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
