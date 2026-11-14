import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { PlotDraft, PlottedTrade } from "../lib/api";
import { money, percent, price } from "../lib/formatTrade";
import { plotMetrics, toDraft } from "../lib/tradePlot";

interface Props {
  plots: PlottedTrade[];
  loading: boolean;
  error: string;
  selectedId: number | null;
  dark: boolean;
  onSelect: (id: number) => void;
  /** Scroll the chart to a trade. */
  onJump: (id: number) => void;
  onChange: (id: number, draft: PlotDraft) => void;
  onDelete: (id: number) => void;
  /** Close the panel (turns Trade plot mode off). */
  onClose: () => void;
}

const shortTime = (iso: string) => iso.replace("T", " ").slice(0, 16).replace(/ 00:00$/, "");

/** One saved trade: where it is, its numbers, and its quantity and note (saved when you leave the field). */
function Row({ plot, selected, dark, onSelect, onJump, onChange, onDelete }: { plot: PlottedTrade; selected: boolean; dark: boolean } & Pick<Props, "onChange" | "onDelete"> & { onSelect: () => void; onJump: () => void }) {
  const [qty, setQty] = useState(plot.qty === null ? "" : String(plot.qty));
  const [note, setNote] = useState(plot.note);
  const m = plotMetrics(plot);
  const long = plot.side === "long";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const field = `px-1.5 py-1 rounded border text-xs ${dark ? "bg-[#131722] border-[#2a2e39] text-slate-200" : "bg-white border-slate-200 text-slate-700"}`;

  const save = () => {
    const n = qty.trim() === "" ? null : Math.floor(Number(qty));
    const nextQty = n !== null && Number.isFinite(n) && n >= 1 ? n : null;
    if (nextQty === plot.qty && note === plot.note) return;
    onChange(plot.id, { ...toDraft(plot), qty: nextQty, note });
  };

  return (
    <div onClick={onSelect}
      className={`rounded border p-2 space-y-1.5 ${selected ? "border-blue-500" : dark ? "border-[#2a2e39]" : "border-slate-200"} ${dark ? "bg-[#1e222d]" : "bg-slate-50"}`}>
      <div className="flex items-center gap-2">
        <button onClick={(e) => { e.stopPropagation(); onJump(); }} title="Show on the chart" className="text-left flex-1 min-w-0">
          <span className={`font-bold ${long ? "text-emerald-500" : "text-red-500"}`}>{long ? "LONG" : "SHORT"}</span>{" "}
          <span className="tabular-nums">{price(plot.entry_price)}</span>
          <span className={`block text-[11px] ${muted}`}>{shortTime(plot.entry_time)}</span>
        </button>
        {m.rr !== null && <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 font-semibold tabular-nums">RR {m.rr.toFixed(2)}</span>}
        <button onClick={(e) => { e.stopPropagation(); onDelete(plot.id); }} title="Delete" className={`p-1 rounded ${dark ? "hover:bg-[#2a2e39]" : "hover:bg-slate-200"}`}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="tabular-nums text-[11px]">
        <span className="text-emerald-500">Target {percent(m.target.pct)}{m.target.money !== null ? ` · ${money(m.target.money)}` : ""}</span>
        <span className={muted}>  |  </span>
        <span className="text-red-500">Stop {percent(m.stop.pct)}{m.stop.money !== null ? ` · ${money(m.stop.money)}` : ""}</span>
      </div>
      <div className="flex gap-2">
        <input className={`${field} w-16 text-right`} type="number" min={1} step={1} placeholder="Qty" value={qty}
          onChange={(e) => setQty(e.target.value)} onBlur={save} onClick={(e) => e.stopPropagation()} />
        <input className={`${field} flex-1 min-w-0`} placeholder="Note" maxLength={500} value={note}
          onChange={(e) => setNote(e.target.value)} onBlur={save} onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

/** The symbol's saved trade boxes, newest entry last, shown while Trade plot mode is on. */
export default function TradePlotPanel({ plots, loading, error, selectedId, dark, onSelect, onJump, onChange, onDelete, onClose }: Props) {
  const muted = dark ? "text-slate-400" : "text-slate-500";
  return (
    <div className={`h-full flex flex-col text-xs ${dark ? "bg-[#131722] text-slate-300" : "bg-white text-slate-700"}`}>
      <div className={`relative px-3 py-2 border-b ${dark ? "border-[#2a2e39]" : "border-slate-200"}`}>
        <button onClick={onClose} title="Close" className={`absolute top-2 right-2 p-1 rounded ${dark ? "hover:bg-[#1e222d]" : "hover:bg-slate-100"}`}><X size={14} /></button>
        <div className={`font-semibold text-sm ${dark ? "text-slate-100" : "text-slate-800"}`}>Plotted trades</div>
        <div className={muted}>{plots.length} saved for this symbol</div>
        {error && <div className="mt-1 text-red-500">{error}</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && <div className={`px-2 py-4 text-center ${muted}`}>Loading...</div>}
        {!loading && plots.length === 0 && (
          <div className={`px-2 py-6 text-center ${muted}`}>No trades yet. Pick Long or Short in the toolbar, then click the chart.</div>
        )}
        {plots.map((p) => (
          <Row key={`${p.id}-${p.updated_at}`} plot={p} selected={p.id === selectedId} dark={dark}
            onSelect={() => onSelect(p.id)} onJump={() => onJump(p.id)} onChange={onChange} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}
