import type { ReactNode } from "react";
import { Minus, Redo2, Slash, Square, Trash2, Undo2, TrendingDown, TrendingUp, X } from "lucide-react";
import type { ChartDrawing, PlottedTrade } from "../lib/api";
import { price } from "../lib/formatTrade";

export type { LayerRef } from "../lib/useLayerHistory";
import type { LayerRef } from "../lib/useLayerHistory";

interface Props {
  symbol: string;
  plots: PlottedTrade[];
  drawings: ChartDrawing[];
  selected: LayerRef | null;
  dark: boolean;
  onSelect: (layer: LayerRef) => void;
  onDelete: (layer: LayerRef) => void;
  onDeleteAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}

interface Row { ref: LayerRef; time: string; title: string; detail: string; icon: ReactNode; color: string }

const shortTime = (iso: string) => iso.replace("T", " ").slice(0, 16).replace(/ 00:00$/, "");

function rows(plots: PlottedTrade[], drawings: ChartDrawing[]): Row[] {
  const out: Row[] = [
    ...plots.map((p): Row => ({
      ref: { type: "trade", id: p.id }, time: p.entry_time, color: p.side === "long" ? "#16a34a" : "#dc2626",
      title: p.side === "long" ? "Long trade" : "Short trade",
      detail: `Entry ${price(p.entry_price)} · SL ${price(p.stop_loss)} · TP ${price(p.target)}`,
      icon: p.side === "long" ? <TrendingUp size={15} /> : <TrendingDown size={15} />,
    })),
    ...drawings.map((d): Row => ({
      ref: { type: "drawing", id: d.id }, time: d.time1, color: d.color,
      title: d.kind === "rect" ? "Rectangle" : d.kind === "hline" ? "Horizontal line" : "Trend line",
      detail: d.kind === "hline" ? price(d.price1) : `${price(d.price1)} → ${price(d.price2)}`,
      icon: d.kind === "rect" ? <Square size={14} /> : d.kind === "hline" ? <Minus size={15} /> : <Slash size={15} />,
    })),
  ];
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Everything plotted on the chart for this symbol, in one list: select an item to find it, delete the ones you no longer want. */
export default function LayersPanel({ symbol, plots, drawings, selected, dark, onSelect, onDelete, onDeleteAll, canUndo, canRedo, onUndo, onRedo, onClose }: Props) {
  const list = rows(plots, drawings);
  const muted = dark ? "text-slate-400" : "text-slate-500";
  return (
    <div className={`h-full flex flex-col ${dark ? "bg-[#131722] text-slate-200" : "bg-white text-slate-800"}`}>
      <div className={`h-10 shrink-0 flex items-center px-3 border-b ${dark ? "border-[#2a2e39]" : "border-slate-200"}`}>
        <span className="text-sm font-semibold">Layers</span>
        <span className={`ml-2 text-xs ${muted}`}>{symbol} · {list.length}</span>
        <div className="ml-auto flex items-center">
          {([["Undo delete", canUndo, onUndo, <Undo2 key="u" size={14} />], ["Redo delete", canRedo, onRedo, <Redo2 key="r" size={14} />]] as const).map(([name, ok, fn, icon]) => (
            <button key={name} onClick={fn} disabled={!ok} title={name}
              className={`p-1 rounded disabled:opacity-30 ${dark ? "hover:bg-[#1e222d]" : "hover:bg-slate-100"}`}>{icon}</button>
          ))}
        </div>
        <button onClick={onClose} title="Close" className={`ml-1 p-1 rounded ${dark ? "hover:bg-[#1e222d]" : "hover:bg-slate-100"}`}><X size={14} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {list.length === 0 && <p className={`p-4 text-xs ${muted}`}>Nothing is plotted on {symbol} yet. Trade boxes, lines and rectangles you draw will be listed here.</p>}
        {list.map((r) => {
          const isSel = selected?.type === r.ref.type && selected.id === r.ref.id;
          return (
            <div key={`${r.ref.type}-${r.ref.id}`} onClick={() => onSelect(r.ref)}
              className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-b ${dark ? "border-[#1e222d]" : "border-slate-100"} ${
                isSel ? (dark ? "bg-blue-500/15" : "bg-blue-50") : (dark ? "hover:bg-[#1e222d]" : "hover:bg-slate-50")}`}>
              <span style={{ color: r.color }}>{r.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold">{r.title}</div>
                <div className={`text-[11px] tabular-nums truncate ${muted}`}>{r.detail}</div>
                <div className={`text-[10px] ${muted}`}>{shortTime(r.time)}</div>
              </div>
              <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(r.ref); }}
                className={`p-1.5 rounded ${dark ? "text-slate-400 hover:text-red-400 hover:bg-[#2a2e39]" : "text-slate-400 hover:text-red-500 hover:bg-red-50"}`}>
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {list.length > 0 && (
        <button onClick={onDeleteAll}
          className={`shrink-0 m-3 py-1.5 rounded text-xs font-semibold border ${dark ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-red-200 text-red-600 hover:bg-red-50"}`}>
          Delete all ({list.length})
        </button>
      )}
    </div>
  );
}
