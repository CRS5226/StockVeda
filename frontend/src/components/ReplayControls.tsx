import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play, X } from "lucide-react";
import { REPLAY_SPEEDS, type ReplayState } from "../lib/useReplay";
import { price as fmtPrice } from "../lib/formatTrade";

interface Props {
  replay: ReplayState;
  /** Date of the newest revealed bar. */
  label: string;
  /** Close of the newest revealed bar. */
  price: number | undefined;
  dark: boolean;
  onExit: () => void;
}

/** Player bar under the chart: back, play / pause, forward, speed, the current candle and exit. */
export default function ReplayControls({ replay, label, price, dark, onExit }: Props) {
  const btn = `p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
    dark ? "text-slate-300 hover:bg-[#1e222d]" : "text-slate-600 hover:bg-slate-100"
  }`;
  const muted = dark ? "text-slate-400" : "text-slate-500";
  return (
    <div className={`shrink-0 flex items-center gap-1 px-3 py-1.5 border-t ${dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
      <button className={btn} onClick={() => replay.step(-10)} disabled={replay.cursor === 0} title="Back 10 candles">
        <ChevronsLeft size={18} />
      </button>
      <button className={btn} onClick={() => replay.step(-1)} disabled={replay.cursor === 0} title="Back 1 candle">
        <ChevronLeft size={18} />
      </button>
      <button onClick={replay.togglePlay} disabled={replay.atEnd && !replay.playing}
        title={replay.playing ? "Pause" : "Play"}
        className="mx-1 p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
        {replay.playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button className={btn} onClick={() => replay.step(1)} disabled={replay.atEnd} title="Forward 1 candle">
        <ChevronRight size={18} />
      </button>
      <button className={btn} onClick={() => replay.step(10)} disabled={replay.atEnd} title="Forward 10 candles">
        <ChevronsRight size={18} />
      </button>
      <div className={`flex rounded overflow-hidden border ml-3 ${dark ? "border-[#2a2e39]" : "border-slate-200"}`}>
        {REPLAY_SPEEDS.map((s) => (
          <button key={s} onClick={() => replay.setSpeed(s)}
            className={`px-2.5 py-1 text-xs font-semibold ${
              replay.speed === s ? "bg-blue-600 text-white" : dark ? "text-slate-300 hover:bg-[#1e222d]" : "text-slate-600 hover:bg-slate-100"
            }`}>
            {s}x
          </button>
        ))}
      </div>
      <span className={`text-xs ml-4 tabular-nums ${muted}`}>
        {label}{replay.atEnd ? " (last candle)" : ""}
      </span>
      {price !== undefined && (
        <span className={`text-xs ml-4 ${muted}`}>
          Price <span className={`font-semibold tabular-nums ${dark ? "text-slate-100" : "text-slate-800"}`}>{fmtPrice(price)}</span>
        </span>
      )}
      <button onClick={onExit} title="Exit replay"
        className={`flex items-center gap-1 ml-auto px-2 py-1 rounded text-xs font-semibold ${dark ? "text-slate-300 hover:bg-[#1e222d]" : "text-slate-600 hover:bg-slate-100"}`}>
        <X size={13} /> Exit replay
      </button>
    </div>
  );
}
