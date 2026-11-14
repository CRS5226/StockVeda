import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { AssetCurrency, AssetDraft, AssetType, PortfolioAsset } from "../../lib/api";
import { resultColor, rupees, signedPercent, signedRupees } from "../../lib/formatMoney";
import { usePortfolioAssets } from "../../lib/usePortfolioAssets";

const TYPES: { value: AssetType; label: string }[] = [
  { value: "crypto", label: "Crypto" }, { value: "us_stock", label: "US stock" }, { value: "mutual_fund", label: "Mutual fund" },
  { value: "bond", label: "Bond" }, { value: "gold", label: "Gold" }, { value: "other", label: "Other" },
];
const typeLabel = Object.fromEntries(TYPES.map((t) => [t.value, t.label])) as Record<AssetType, string>;
const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";

/** Amount in the asset's own currency: ₹1,000.00 or $1,000.00. */
const money = (n: number, c: AssetCurrency) => (c === "USD" ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : rupees(n));
const signed = (n: number, c: AssetCurrency) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${money(Math.abs(n), c)}`;

const blank = (): AssetDraft => ({ name: "", asset_type: "crypto", currency: "INR", qty: 0, buy_price: 0, current_price: 0, buy_date: null });

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-slate-500">{name}{children}</label>;
}

function AssetForm({ initial, onSave, onCancel }: { initial: AssetDraft; onSave: (d: AssetDraft) => Promise<boolean>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AssetDraft>(k: K, v: AssetDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const ready = d.name.trim() !== "" && d.qty > 0 && d.buy_price > 0 && d.current_price > 0;
  const num = (k: "qty" | "buy_price" | "current_price") => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await onSave({ ...d, name: d.name.trim() })) onCancel();
    setSaving(false);
  };
  return (
    <form onSubmit={submit} className="p-4 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
      <Field name="Name"><input className={input} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Bitcoin, AAPL, Gold ETF…" /></Field>
      <Field name="Type">
        <select className={input} value={d.asset_type} onChange={(e) => { const t = e.target.value as AssetType; setD((p) => ({ ...p, asset_type: t, currency: t === "us_stock" ? "USD" : p.currency })); }}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field name="Prices are in">
        <select className={input} value={d.currency} onChange={(e) => set("currency", e.target.value as AssetCurrency)}>
          <option value="INR">Rupees (₹)</option><option value="USD">US dollars ($)</option>
        </select>
      </Field>
      <Field name="Quantity"><input className={input} type="number" min={0} step="any" value={d.qty || ""} onChange={num("qty")} /></Field>
      <Field name="Buy price (each)"><input className={input} type="number" min={0} step="any" value={d.buy_price || ""} onChange={num("buy_price")} /></Field>
      <Field name="Current price (each)"><input className={input} type="number" min={0} step="any" value={d.current_price || ""} onChange={num("current_price")} /></Field>
      <Field name="Buy date (optional)"><input className={input} type="date" value={d.buy_date ?? ""} onChange={(e) => set("buy_date", e.target.value || null)} /></Field>
      <div className="flex gap-2">
        <button disabled={!ready || saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </form>
  );
}

/** The current price changes often, so it is edited right in the table and saved when the field is left. */
function PriceCell({ asset, onSave }: { asset: PortfolioAsset; onSave: (price: number) => void }) {
  const [v, setV] = useState(String(asset.current_price));
  const save = () => { const n = Number(v); if (n > 0 && n !== asset.current_price) onSave(n); };
  return <input className="w-28 px-1.5 py-1 text-xs text-right border border-slate-200 rounded bg-white focus:outline-none focus:border-blue-400 tabular-nums"
    type="number" min={0} step="any" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

function RateBox({ rate, onSave }: { rate: number | null; onSave: (r: number | null) => void }) {
  const [v, setV] = useState(rate === null ? "" : String(rate));
  const save = () => { const n = v.trim() === "" ? null : Number(v); if (n !== rate && (n === null || n > 0)) onSave(n); };
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500" title="Used to show your dollar assets in rupees">
      1 USD =
      <input className="w-20 px-1.5 py-1 text-xs text-right border border-slate-200 rounded bg-white focus:outline-none focus:border-blue-400 tabular-nums" type="number" min={0} step="any"
        placeholder="₹" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      ₹
    </label>
  );
}

/** Crypto, US stocks, mutual funds, bonds, gold and anything else, with prices typed in. Shown in rupees using the USD rate entered here. */
export default function AssetsSection({ portfolioId }: { portfolioId: number }) {
  const a = usePortfolioAssets(portfolioId);
  // null: form closed, "new": adding, a number: editing that asset
  const [editing, setEditing] = useState<null | "new" | number>(null);
  const list = a.listing?.assets ?? [];
  const totals = a.listing?.totals;
  const editingAsset = typeof editing === "number" ? list.find((x) => x.id === editing) : undefined;
  const hasUsd = list.some((x) => x.currency === "USD");

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
        <h3 className="font-semibold">Other investments</h3>
        {totals && list.length > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">
            {rupees(totals.invested)} invested · {rupees(totals.value)} now ·{" "}
            <span className={resultColor(totals.pnl)}>{signedRupees(totals.pnl)}{totals.pnl_pct !== null && ` (${signedPercent(totals.pnl_pct)})`}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <RateBox key={a.listing?.usd_inr ?? "none"} rate={a.listing?.usd_inr ?? null} onSave={(r) => void a.setRate(r)} />
          <button onClick={() => setEditing(editing === null ? "new" : null)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            {editing === null ? <><Plus size={13} /> Add</> : <><X size={13} /> Close</>}
          </button>
        </div>
      </div>
      {a.error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{a.error}</div>}
      {totals && totals.unconverted > 0 && (
        <div className="mx-4 mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Enter the USD to INR rate above to include {totals.unconverted} dollar {totals.unconverted === 1 ? "asset" : "assets"} in the rupee totals.
        </div>
      )}
      {editing === "new" && <AssetForm initial={blank()} onSave={a.add} onCancel={() => setEditing(null)} />}
      {editingAsset && <AssetForm key={editingAsset.id} initial={editingAsset} onSave={(d) => a.update(editingAsset.id, d)} onCancel={() => setEditing(null)} />}
      {list.length === 0 && editing === null && (
        <div className="py-8 text-center text-sm text-slate-400">No other investments yet. Add crypto, US stocks, gold or anything else you hold.</div>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-xs text-slate-500 text-left">
                {["Asset", "Quantity", "Buy price", "Current price", "Invested", "Value", "P&L", "P&L %", "", ""].map((c, i) => (
                  <th key={i} className={`px-3 py-2 font-medium ${i >= 1 && i <= 7 ? "text-right" : ""}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><div className="font-semibold">{x.name}</div><div className="text-[11px] text-slate-400">{typeLabel[x.asset_type]} · {x.currency}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.qty.toLocaleString("en-IN", { maximumFractionDigits: 8 })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(x.buy_price, x.currency)}</td>
                  <td className="px-3 py-2 text-right"><PriceCell key={x.current_price} asset={x} onSave={(p) => void a.update(x.id, { ...x, current_price: p })} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(x.invested, x.currency)}{x.currency === "USD" && x.invested_inr !== null && <div className="text-[11px] text-slate-400">{rupees(x.invested_inr)}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(x.value, x.currency)}{x.currency === "USD" && x.value_inr !== null && <div className="text-[11px] text-slate-400">{rupees(x.value_inr)}</div>}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${resultColor(x.pnl)}`}>{signed(x.pnl, x.currency)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${resultColor(x.pnl_pct)}`}>{x.pnl_pct === null ? "—" : signedPercent(x.pnl_pct)}</td>
                  <td className="px-1 py-2 text-right"><button title="Edit" onClick={() => setEditing(x.id)} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Pencil size={14} /></button></td>
                  <td className="px-2 py-2 text-right">
                    <button title="Delete" onClick={() => { if (window.confirm(`Delete "${x.name}"?`)) void a.remove(x.id); }}
                      className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasUsd && <p className="px-4 py-2 text-[11px] text-slate-400">Dollar assets show their rupee value underneath once the USD to INR rate is entered.</p>}
        </div>
      )}
    </div>
  );
}
