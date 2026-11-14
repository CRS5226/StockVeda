import { useState } from "react";
import type { HealthSettings } from "../../../lib/api";
import { TARGET_TYPES } from "../../../lib/healthLabels";

const input = "w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400";

/** The limits the portfolio is checked against. Nothing here is advice: change them to whatever you want to hold to. */
export default function HealthTargets({ settings, onSave }: { settings: HealthSettings; onSave: (s: HealthSettings) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [maxPos, setMaxPos] = useState(String(settings.max_position_pct));
  const [band, setBand] = useState(String(settings.band_pp));
  const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings.targets).map(([k, v]) => [k, String(v)])));
  const [saving, setSaving] = useState(false);

  const numbers = Object.fromEntries(Object.entries(targets).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
  const sum = Object.values(numbers).reduce((a, b) => a + b, 0);
  const valid = Number(maxPos) > 0 && Number(maxPos) <= 100 && Number(band) >= 0 && sum <= 100;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await onSave({ max_position_pct: Number(maxPos), band_pp: Number(band), targets: numbers })) setOpen(false);
    setSaving(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <h3 className="font-semibold">Your targets</h3>
        <span className="text-xs text-slate-500">
          Largest stock {settings.max_position_pct}% · allowed drift ±{settings.band_pp} points
          {Object.keys(settings.targets).length > 0 ? ` · ${Object.keys(settings.targets).length} type targets` : " · no type targets set"}
        </span>
        <span className="ml-auto text-xs font-semibold text-blue-600">{open ? "Close" : "Change"}</span>
      </button>
      {open && (
        <form onSubmit={save} className="px-4 pb-4 border-t border-slate-100 pt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">Largest share of one stock (%)
              <input className={input} type="number" min={0} max={100} step="any" value={maxPos} onChange={(e) => setMaxPos(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">Allowed drift from a target (± points)
              <input className={input} type="number" min={0} max={50} step="any" value={band} onChange={(e) => setBand(e.target.value)} />
            </label>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-2">Target share of the portfolio for each type (%). Leave a type empty to leave it unchecked.</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {TARGET_TYPES.map((t) => (
                <label key={t.key} className="flex flex-col gap-1 text-xs text-slate-500">{t.label}
                  <input className={input} type="number" min={0} max={100} step="any" placeholder="—" value={targets[t.key] ?? ""}
                    onChange={(e) => setTargets((p) => ({ ...p, [t.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <div className={`mt-2 text-xs tabular-nums ${sum > 100 ? "text-red-600" : "text-slate-500"}`}>Targets add up to {sum.toFixed(1)}%{sum > 100 ? ": they cannot be more than 100%." : "."}</div>
          </div>
          <div>
            <button disabled={!valid || saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saving ? "Saving…" : "Save targets"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
