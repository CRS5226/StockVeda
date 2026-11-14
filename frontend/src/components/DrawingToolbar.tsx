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
  const base = "w-9 h-9 flex items-center justify-center rounded transition-colors";
  const idle = dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800";
  const on = dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600";
  return (
    <div className={`w-12 shrink-0 flex flex-col items-center gap-1 py-2 border-r ${dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
      <button onClick={onTogglePlot} title="Trade plot: plot long / short trades on the chart and save them" className={`${base} ${plotMode ? on : idle}`}>
        <PencilRuler size={17} />
      </button>
      {plotMode && (["long", "short"] as const).map((side) => (
        <button key={side} onClick={() => onTool(tool === side ? null : side)} title={`Place a ${side} trade box: click the chart`}
          className={`${base} ${tool === side ? (side === "long" ? "bg-emerald-600 text-white" : "bg-red-600 text-white")
            : side === "long" ? "text-emerald-500 hover:bg-emerald-500/10" : "text-red-500 hover:bg-red-500/10"}`}>
          {side === "long" ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
        </button>
      ))}
      <div className={`w-6 h-px my-1 ${dark ? "bg-[#2a2e39]" : "bg-slate-200"}`} />
      {([
        { kind: "line", title: "Trend line: click two points", icon: <Slash size={17} /> },
        { kind: "hline", title: "Horizontal line: click a price", icon: <Minus size={17} /> },
        { kind: "rect", title: "Rectangle: click two corners", icon: <Square size={16} /> },
      ] as const).map(({ kind, title, icon }) => (
        <button key={kind} onClick={() => onDrawTool(drawTool === kind ? null : kind)} title={title} className={`${base} ${drawTool === kind ? on : idle}`}>
          {icon}
        </button>
      ))}
    </div>
  );
}
