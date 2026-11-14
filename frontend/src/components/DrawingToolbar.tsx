import { PencilRuler, TrendingDown, TrendingUp } from "lucide-react";
import type { PlotSide } from "../lib/tradePlot";

interface Props {
  dark: boolean;
  /** Trade plot mode is on: boxes can be placed and edited. */
  plotMode: boolean;
  onTogglePlot: () => void;
  /** The armed trade box tool, if any. */
  tool: PlotSide | null;
  onTool: (side: PlotSide | null) => void;
}

/** Vertical tool strip on the left of the chart, like TradingView's drawing tools. */
export default function DrawingToolbar({ dark, plotMode, onTogglePlot, tool, onTool }: Props) {
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
    </div>
  );
}
