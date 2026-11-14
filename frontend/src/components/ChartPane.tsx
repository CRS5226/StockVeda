import { useEffect, useState } from "react";
import { AlertCircle, Download, RefreshCw } from "lucide-react";
import BacktestChart, { type ChartHandle, type SmcToggles } from "./BacktestChart";
import SymbolCombobox from "./SymbolCombobox";
import TradePlotOverlay from "./TradePlotOverlay";
import { useChartData } from "../lib/useChartData";
import { useTradePlots } from "../lib/useTradePlots";
import type { ChartTheme } from "../lib/chartTheme";
import type { Candle } from "../lib/api";

export interface PaneSetting { symbol: string; tf: string }

interface Props {
  setting: PaneSetting;
  onChange: (next: PaneSetting) => void;
  smc: SmcToggles;
  swingLength: number;
  theme: ChartTheme;
  /** The chart is ready (or gone) / the pane's bars changed, for the crosshair sync. */
  onChart: (handle: ChartHandle | null) => void;
  onBars: (bars: Candle[]) => void;
}

/** One chart of the split layout: its own symbol, timeframe and data, with a header to change them. */
export default function ChartPane({ setting, onChange, smc, swingLength, theme, onChart, onBars }: Props) {
  const { symbol, tf } = setting;
  const dark = theme === "dark";
  const { timeframes, bars, loading, busy, error, notice, fetching, syncing, fetchMissing, sync } = useChartData(symbol, tf);
  const tradePlots = useTradePlots(symbol);
  const [draft, setDraft] = useState(symbol);
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  useEffect(() => setDraft(symbol), [symbol]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onBars(bars), [bars]);

  const ohlcv = bars.map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }));
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const tab = (active: boolean) => `px-2 py-1 rounded text-xs font-semibold transition-colors ${
    active ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
      : (dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}`;
  const working = fetching || syncing;

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className={`h-10 shrink-0 flex items-center gap-2 px-2 border-b ${dark ? "border-[#2a2e39]" : "border-slate-200"}`}>
        <div className="w-40 shrink-0">
          <SymbolCombobox value={draft} onChange={setDraft}
            onSelect={(s) => { const sym = s.trim().toUpperCase(); if (sym) onChange({ symbol: sym, tf }); }} placeholder="Symbol…" />
        </div>
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {timeframes.map((t) => (
            <button key={t.key} onClick={() => onChange({ symbol, tf: t.key })} className={tab(t.key === tf)}>{t.key}</button>
          ))}
        </div>
        <div className={`ml-auto flex items-center gap-2 text-xs whitespace-nowrap ${muted}`}>
          {busy && <span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />}
          {notice && !fetching && <span className="hidden xl:inline">{notice}</span>}
          <button onClick={sync} disabled={loading || working || bars.length === 0} title="Fetch the newest missing candles"
            className={`flex items-center gap-1 px-1.5 py-1 rounded font-semibold disabled:opacity-40 ${dark ? "hover:bg-[#1e222d]" : "hover:bg-slate-100"}`}>
            <RefreshCw size={12} className={working ? "animate-spin" : ""} /> {working ? "Syncing…" : "Sync"}
          </button>
          {bars.length > 0 && <span>{bars.length.toLocaleString()}</span>}
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <BacktestChart fill ohlcv={ohlcv} symbol={symbol} smc={smc} theme={theme} structureMode="swing" swingLength={swingLength}
          onChartReady={(h) => { setHandle(h); onChart(h); }} />
        {handle && bars.length > 0 && (
          <TradePlotOverlay chart={handle.chart} series={handle.series} bars={bars} symbol={symbol} plots={tradePlots.plots}
            editable={false} tool={null} dark={dark} selectedId={null} onSelect={() => {}}
            onCreate={async () => null} onChange={() => {}} onDelete={() => {}} onToolDone={() => {}} />
        )}
        {bars.length === 0 && busy && !error && (
          <div className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 text-sm ${dark ? "bg-[#131722]/90 text-slate-300" : "bg-white/90 text-slate-600"}`}>
            <span className="w-8 h-8 border-4 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
            <span>{fetching ? `Downloading ${tf} candles for ${symbol}…` : `Loading ${symbol} ${tf}…`}</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>
          </div>
        )}
        {!busy && !error && bars.length === 0 && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm ${muted}`}>
            <span>No {tf} bars stored for {symbol}.</span>
            <button onClick={fetchMissing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
              <Download size={13} /> Fetch data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
