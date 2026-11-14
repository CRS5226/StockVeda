import { useState } from "react";
import type { SignalSettings } from "../../../lib/api";

const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";

const FIELDS: { key: keyof SignalSettings; label: string; hint: string; max?: number }[] = [
  { key: "profit_gain_pct", label: "Profit-booking zone: gain at least (%)", hint: "The position is up at least this much" },
  { key: "profit_rsi", label: "…and daily RSI at least", hint: "Or the close is above the upper Bollinger band", max: 100 },
  { key: "loss_pct", label: "Recovery zone: loss at least (%)", hint: "The position is down at least this much, and MACD has turned up with the close above the 20-day EMA" },
  { key: "trim_pct", label: "Trim arithmetic: share of the position (%)", hint: "Used in the \"if you sold part\" numbers", max: 100 },
  { key: "add_budget", label: "Add arithmetic: amount (₹)", hint: "Used in the \"if you added\" numbers, within your size limit" },
];

/** The thresholds behind the zones. They are yours to set; the defaults are only a starting point. */
export default function SignalsSettings({ settings, onSave }: { settings: SignalSettings; onSave: (s: SignalSettings) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])));
  const [saving, setSaving] = useState(false);
  const valid = FIELDS.every((f) => Number(values[f.key]) > 0 && (f.max === undefined || Number(values[f.key]) <= f.max));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const next = Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])])) as unknown as SignalSettings;
    if (await onSave(next)) setOpen(false);
    setSaving(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <h3 className="font-semibold">Your zone thresholds</h3>
        <span className="text-xs text-slate-500">
          Profit-booking: gain ≥ {settings.profit_gain_pct}% and RSI ≥ {settings.profit_rsi} · Recovery: loss ≥ {settings.loss_pct}% with the turn
        </span>
        <span className="ml-auto text-xs font-semibold text-blue-600">{open ? "Close" : "Change"}</span>
      </button>
      {open && (
        <form onSubmit={save} className="px-4 pb-4 border-t border-slate-100 pt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs text-slate-500" title={f.hint}>{f.label}
                <input className={input} type="number" min={0} max={f.max} step="any" value={values[f.key]} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div>
            <button disabled={!valid || saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saving ? "Saving…" : "Save thresholds"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
