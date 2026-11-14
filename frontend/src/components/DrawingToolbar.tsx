import { Minus, PencilRuler, Slash, Square, TrendingDown, TrendingUp } from "lucide-react";
import type { DrawKind } from "../lib/drawings";
import type { PlotSide } from "../lib/tradePlot";

interface Props {
  dark: boolean;
  /** Trade plot mode is on: boxes can be placed and edited. */
  plotMode: boolean;
  onTogglePlot: () => void;
  /** The armed trade box tool, if any. */
  tool: PlotSide | null;
  onTool: (side: PlotSide | null) => void;
  /** The armed line / rectangle tool, if any. */
  drawTool: DrawKind | null;
  onDrawTool: (kind: DrawKind | null) => void;
}

/** Vertical tool strip on the left of the chart, like TradingView's drawing tools. */
export default function DrawingToolbar({ dark, plotMode, onTogglePlot, tool, onTool, drawTool, onDrawTool }: Props) {
  const base = "group relative w-9 h-9 flex items-center justify-center rounded transition-colors";
  // Name shown to the right of the icon on hover (the native title tooltip is slow to appear).
  const tip = (name: string) => (
    <span className={`pointer-events-none absolute left-full ml-2 px-2 py-1 rounded text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 shadow-lg z-50 ${
      dark ? "bg-[#2a2e39] text-slate-100" : "bg-slate-800 text-white"}`}>{name}</span>
  );
  const idle = dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800";
  const on = dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600";
  return (
    <div className={`relative z-30 w-12 shrink-0 flex flex-col items-center gap-1 py-2 border-r ${dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
      <button onClick={onTogglePlot} aria-label="Trade plot" className={`${base} ${plotMode ? on : idle}`}>
        <PencilRuler size={17} />{tip("Trade plot")}
      </button>
      {plotMode && (["long", "short"] as const).map((side) => (
        <button key={side} onClick={() => onTool(tool === side ? null : side)} aria-label={`${side} trade box`}
          className={`${base} ${tool === side ? (side === "long" ? "bg-emerald-600 text-white" : "bg-red-600 text-white")
            : side === "long" ? "text-emerald-500 hover:bg-emerald-500/10" : "text-red-500 hover:bg-red-500/10"}`}>
          {side === "long" ? <TrendingUp size={17} /> : <TrendingDown size={17} />}{tip(side === "long" ? "Long trade box" : "Short trade box")}
        </button>
      ))}
      <div className={`w-6 h-px my-1 ${dark ? "bg-[#2a2e39]" : "bg-slate-200"}`} />
      {([
        { kind: "line", name: "Trend line", icon: <Slash size={17} /> },
        { kind: "hline", name: "Horizontal line", icon: <Minus size={17} /> },
        { kind: "rect", name: "Rectangle", icon: <Square size={16} /> },
      ] as const).map(({ kind, name, icon }) => (
        <button key={kind} onClick={() => onDrawTool(drawTool === kind ? null : kind)} aria-label={name} className={`${base} ${drawTool === kind ? on : idle}`}>
          {icon}{tip(name)}
        </button>
      ))}
    </div>
  );
}
