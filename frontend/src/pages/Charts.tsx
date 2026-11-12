import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesMarker, Time } from "lightweight-charts";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, Download, Layers, Moon, PencilRuler, RefreshCw, Rewind, Sun } from "lucide-react";
import BacktestChart, { NO_SMC, type ChartHandle } from "../components/BacktestChart";
import OrderCards from "../components/OrderCards";
import OrderOverlay from "../components/OrderOverlay";
import ReplayControls from "../components/ReplayControls";
import TradePanel from "../components/TradePanel";
import TradePlotOverlay from "../components/TradePlotOverlay";
import TradePlotPanel from "../components/TradePlotPanel";
import SmcFloatingBox from "../components/SmcFloatingBox";
import SymbolCombobox from "../components/SymbolCombobox";
import { useChartData } from "../lib/useChartData";
import { useReplay } from "../lib/useReplay";
import { useTradePlots } from "../lib/useTradePlots";
import { normTime, timeToIndex, type PlotSide } from "../lib/tradePlot";
import { barKey, toChartTime } from "../lib/barTime";
import {
  adjustLevels, closeAll, closePosition, closeTradeAtMarket, evaluateTrade, marketDirection, placeOrder, positionOf,
  type Instrument, type Order, type PaperTrade, type Position,
} from "../lib/paperTrading";
import { buildOrder, DEFAULT_SETTINGS, type CardSettings } from "../lib/orderSettings";
import { loadChartTheme, saveChartTheme, type ChartTheme } from "../lib/chartTheme";
import { loadSmcPrefs, saveSmcPrefs, loadStructureSettings, saveStructureSettings, type StructureSettings } from "../lib/smcPrefs";

export const DEFAULT_CHART_SYMBOL = "HDFCBANK";
const DEFAULT_TIMEFRAME = "5m";

/** Full-screen, TradingView-style chart page. Fills everything below the navbar. */
export default function Charts() {
  const { symbol: routeSymbol } = useParams();
  const navigate = useNavigate();
  const symbol = (routeSymbol ?? DEFAULT_CHART_SYMBOL).toUpperCase();
  const [tf, setTf] = useState(DEFAULT_TIMEFRAME);
  const [draft, setDraft] = useState(symbol);
  const [theme, setTheme] = useState<ChartTheme>(loadChartTheme);
  const dark = theme === "dark";
  const [smc, setSmc] = useState(loadSmcPrefs);
  const [smcOpen, setSmcOpen] = useState(false);
  const [structure, setStructure] = useState(loadStructureSettings);
  const { timeframes, bars, loading, error, notice, fetching, fetchMissing, sync } = useChartData(symbol, tf);
  const replay = useReplay(bars.length);
  const [picking, setPicking] = useState(false); // waiting for a click on the candle to start from
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const nextTradeId = useRef(1);
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  // Trade plot mode: long / short trade boxes drawn on the chart and saved in the database
  const [plotMode, setPlotMode] = useState(false);
  const [plotTool, setPlotTool] = useState<PlotSide | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<number | null>(null);
  const tradePlots = useTradePlots(symbol);
  // card values per instrument, shared by the cards and the "+" menu on the chart
  const [settings, setSettings] = useState<Record<Instrument, CardSettings>>({ CE: DEFAULT_SETTINGS, PE: DEFAULT_SETTINGS });
  // a stop-loss / target line being dragged: shown on the chart and the cards at once, committed when dropped
  const [live, setLive] = useState<Partial<Record<Instrument, { stopLoss?: number; target?: number }>>>({});

  // A different symbol, timeframe or data set means the replay position and trades no longer apply.
  useEffect(() => {
    replay.exit();
    setPicking(false);
    setTrades([]);
    setLive({});
    setPlotTool(null);
    setSelectedPlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, bars]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  // Keep the search box in step with the URL (back/forward, links).
  useEffect(() => setDraft(symbol), [symbol]);

  const pick = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (s) navigate(`/charts/${encodeURIComponent(s)}`);
  };

  const toggleTheme = () => {
    const next: ChartTheme = dark ? "light" : "dark";
    setTheme(next);
    saveChartTheme(next);
  };

  const changeSmc = (next: typeof smc) => {
    setSmc(next);
    saveSmcPrefs(next);
  };

  const changeStructure = (next: StructureSettings) => {
    setStructure(next);
    saveStructureSettings(next);
  };

  // Stable rows for the chart; the SMC detectors recompute only when the bars change.
  const ohlcv = useMemo(
    () => bars.map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume })),
    [bars],
  );
  const smcActive = Object.values(smc).some(Boolean);

  // Replay shows only the bars up to the cursor, with SMC off.
  const shown = useMemo(() => (replay.active ? ohlcv.slice(0, replay.cursor + 1) : ohlcv), [ohlcv, replay.active, replay.cursor]);
  const indexByTime = useMemo(
    () => new Map(bars.map((b, i) => [String(toChartTime(barKey(b.date))), i] as const)),
    [bars],
  );
  const timeAt = (i: number): Time => toChartTime(barKey(bars[i].date));
  const price = replay.active ? bars[replay.cursor]?.close : undefined;

  // Entries / exits as markers and the entry, stop-loss and target of open trades as price lines.
  const tradeMarkers = useMemo(() => {
    if (!replay.active) return [] as SeriesMarker<Time>[];
    const out: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      const s = evaluateTrade(t, bars, replay.cursor);
      if (s.status === "pending") continue;
      const long = marketDirection(t.instrument, t.side) === 1; // gains as the chart price rises
      out.push({
        time: toChartTime(barKey(bars[t.entryIndex].date)), position: long ? "belowBar" : "aboveBar",
        shape: long ? "arrowUp" : "arrowDown", color: long ? "#16a34a" : "#dc2626",
        text: `${t.side === "buy" ? "B" : "S"} ${t.instrument}`, size: 1,
      });
      for (const e of s.exits) {
        out.push({
          time: toChartTime(barKey(bars[e.index].date)), position: long ? "aboveBar" : "belowBar", shape: "circle",
          color: e.reason === "target" ? "#16a34a" : e.reason === "stoploss" ? "#dc2626" : "#64748b",
          text: e.reason === "target" ? "T" : e.reason === "stoploss" ? "SL" : `X ${e.qty}`, size: 1,
        });
      }
    }
    return out;
  }, [trades, bars, replay.active, replay.cursor]);

  const onChartClick = (time: Time) => {
    if (!picking) return;
    const i = indexByTime.get(String(time));
    if (i === undefined) return;
    replay.start(i);
    setPicking(false);
    setSmcOpen(false);
    setPlotMode(false);
    setPlotTool(null);
  };

  /** Scroll the chart to a saved trade box. */
  const jumpToPlot = (id: number) => {
    const plot = tradePlots.plots.find((p) => p.id === id);
    if (!plot || !handle) return;
    const index = timeToIndex(bars.map((b) => normTime(barKey(b.date))), normTime(plot.entry_time));
    if (index < 0) return;
    setSelectedPlot(id);
    handle.chart.timeScale().setVisibleLogicalRange({ from: index - 30, to: index + 60 });
  };

  const exitReplay = () => {
    if (trades.length > 0 && !window.confirm("Exit replay? Your paper trades will be cleared.")) return;
    replay.exit();
    setTrades([]);
  };

  // What is open on each instrument; an order nets against it (selling 3 of a 10-lot buy leaves 7).
  const heldNow = useMemo(
    () => ({
      CE: replay.active ? positionOf(trades, bars, replay.cursor, "CE") : null,
      PE: replay.active ? positionOf(trades, bars, replay.cursor, "PE") : null,
    }),
    [trades, bars, replay.active, replay.cursor],
  );
  // the same positions with a line that is being dragged applied, for the chart and the cards
  const positions = useMemo(() => {
    const show = (p: Position | null, drag?: { stopLoss?: number; target?: number }) =>
      p && drag ? { ...p, stopLoss: drag.stopLoss ?? p.stopLoss, target: drag.target ?? p.target } : p;
    return { CE: show(heldNow.CE, live.CE), PE: show(heldNow.PE, live.PE) };
  }, [heldNow, live]);

  const placeTrade = (order: Order) => {
    if (price === undefined) return;
    setTrades((prev) => placeOrder(prev, order, bars, replay.cursor, nextTradeId.current++).trades);
  };

  const moveLevels = (instrument: Instrument, changes: { stopLoss?: number | null; target?: number | null; trail?: number | null }) => {
    setTrades((prev) => adjustLevels(prev, instrument, changes, bars, replay.cursor));
  };

  const dragLevel = (instrument: Instrument, kind: "stoploss" | "target", level: number) =>
    setLive((l) => ({ ...l, [instrument]: { ...l[instrument], [kind === "stoploss" ? "stopLoss" : "target"]: level } }));

  const dropLevel = (instrument: Instrument, kind: "stoploss" | "target", level: number) => {
    setLive((l) => ({ ...l, [instrument]: undefined }));
    const held = heldNow[instrument];
    if (kind === "target") { moveLevels(instrument, { target: level }); return; }
    // dropping the stop-loss while a trail is on: it keeps trailing from there, with the new gap to the price as the trail
    moveLevels(instrument, held && held.trail !== null && price !== undefined
      ? { stopLoss: level, trail: (price - level) * held.direction }
      : { stopLoss: level });
  };

  /** Buy from the "+" menu on the chart: the card's levels, the quantity typed there. Returns an error message or null. */
  const buyFromChart = (instrument: Instrument, qty: number): string | null => {
    if (price === undefined) return "No price yet.";
    const built = buildOrder(instrument, "buy", settings[instrument], price, heldNow[instrument], qty);
    if ("error" in built) return built.error;
    placeTrade(built.order);
    return null;
  };

  const orderSummary = (instrument: Instrument): string => {
    const held = heldNow[instrument];
    if (held && held.side === "buy") return "Adds to your position with its stop-loss and target.";
    const { slValue, slUnit, tpValue, tpUnit } = settings[instrument];
    return `Stop-loss ${slValue.trim() ? `${slValue}${slUnit}` : "none"} · Target ${tpValue.trim() ? `${tpValue}${tpUnit}` : "none"} (from the ${instrument} card)`;
  };

  const exitFromChart = (instrument: Instrument, qty: number) =>
    setTrades((prev) => closePosition(prev, instrument, qty, bars, replay.cursor));

  const closeTrade = (id: number) => {
    setTrades((prev) => closeTradeAtMarket(prev, id, bars, replay.cursor));
  };

  const empty = !loading && !fetching && !error && bars.length === 0;

  return (
    <div className={`h-full flex flex-col ${dark ? "bg-[#131722]" : "bg-white"}`}>
      {/* Top toolbar */}
      <div className={`h-11 shrink-0 flex items-center gap-3 px-3 border-b ${dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
        <div className="w-56">
          <SymbolCombobox value={draft} onChange={setDraft} onSelect={pick} placeholder="Search symbol…" />
        </div>
        <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>{symbol}</span>
        <div className={`w-px h-5 ${dark ? "bg-[#2a2e39]" : "bg-slate-200"}`} />
        {replay.active ? (
          <span className={`px-2 py-1 rounded text-xs font-semibold ${dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600"}`}>
            Replay mode
          </span>
        ) : (
        <div className="flex items-center gap-0.5">
          {timeframes.map((t) => (
            <button key={t.key} onClick={() => setTf(t.key)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                t.key === tf
                  ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
                  : (dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
              }`}>
              {t.key}
            </button>
          ))}
        </div>
        )}
        {!replay.active && (
          <button onClick={() => { setPicking((v) => !v); setPlotMode(false); setPlotTool(null); }} disabled={bars.length < 10}
            title="Replay the chart candle by candle and place paper trades"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-40 ${
              picking
                ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
                : (dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
            }`}>
            <Rewind size={14} /> Replay
          </button>
        )}
        <button onClick={() => setSmcOpen((v) => !v)} disabled={replay.active}
          title={replay.active ? "SMC overlays are off during replay" : "Smart Money Concepts overlays"}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-40 ${
            smcOpen
              ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
              : (dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
          }`}>
          <Layers size={14} /> SMC
          {smcActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
        </button>
        <button onClick={() => { setPlotMode((v) => !v); setPlotTool(null); setPicking(false); }} disabled={replay.active}
          title={replay.active ? "Trade plot is off during replay" : "Plot long / short trades on the chart and save them"}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-40 ${
            plotMode
              ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
              : (dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
          }`}>
          <PencilRuler size={14} /> Trade plot
        </button>
        {plotMode && !replay.active && (
          <div className="flex items-center gap-1">
            {(["long", "short"] as const).map((side) => (
              <button key={side} onClick={() => setPlotTool((t) => (t === side ? null : side))}
                title={`Place a ${side} trade box: click the chart`}
                className={`px-2.5 py-1 rounded text-xs font-bold border transition-colors ${
                  plotTool === side
                    ? (side === "long" ? "bg-emerald-600 text-white border-emerald-600" : "bg-red-600 text-white border-red-600")
                    : (side === "long" ? "text-emerald-500 border-emerald-500/50 hover:bg-emerald-500/10" : "text-red-500 border-red-500/50 hover:bg-red-500/10")
                }`}>
                {side === "long" ? "Long" : "Short"}
              </button>
            ))}
          </div>
        )}
        <div className={`ml-auto flex items-center gap-3 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {(loading || fetching) && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
              {fetching ? "Downloading data…" : "Loading…"}
            </span>
          )}
          {notice && !fetching && <span>{notice}</span>}
          <button onClick={sync} disabled={loading || fetching || bars.length === 0} title="Fetch the newest candles that are missing for this symbol and timeframe"
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-40 ${
              dark ? "text-slate-300 hover:bg-[#1e222d]" : "text-slate-600 hover:bg-slate-100"
            }`}>
            <RefreshCw size={13} className={fetching ? "animate-spin" : ""} /> Sync data
          </button>
          {bars.length > 0 && !replay.active && <span>{bars.length.toLocaleString()} bars</span>}
          <button onClick={toggleTheme} title={dark ? "Switch chart to light mode" : "Switch chart to dark mode"}
            className={`p-1.5 rounded transition-colors ${dark ? "text-slate-300 hover:bg-[#1e222d]" : "text-slate-500 hover:bg-slate-100"}`}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      {/* Chart area: the chart (with the order bar under it during replay) and, in replay, the trades on the right */}
      <div className="flex flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-w-0">
      <div className="relative flex-1 min-h-0">
        <BacktestChart fill ohlcv={shown} symbol={symbol} smc={replay.active ? NO_SMC : smc} theme={theme}
          structureMode="swing" swingLength={structure.length} stableView={replay.active}
          onChartClick={onChartClick} extraMarkers={tradeMarkers} onChartReady={setHandle} />
        {replay.active && handle && price !== undefined && (
          <OrderOverlay chart={handle.chart} series={handle.series} positions={positions} price={price} dark={dark}
            summary={{ CE: orderSummary("CE"), PE: orderSummary("PE") }}
            onDrag={dragLevel} onDrop={dropLevel} onExit={exitFromChart} onBuy={buyFromChart} />
        )}
        {handle && !replay.active && (
          <TradePlotOverlay chart={handle.chart} series={handle.series} bars={bars} symbol={symbol} plots={tradePlots.plots}
            editable={plotMode} tool={plotTool} dark={dark} selectedId={selectedPlot} onSelect={setSelectedPlot}
            onCreate={tradePlots.create} onChange={tradePlots.update} onDelete={(id) => { void tradePlots.remove(id); setSelectedPlot(null); }}
            onToolDone={() => setPlotTool(null)} />
        )}
        {picking && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold shadow-lg">
            Click a candle to start the replay from it (Esc to cancel)
          </div>
        )}
        {smcOpen && !replay.active && <SmcFloatingBox smc={smc} onChange={changeSmc} onClose={() => setSmcOpen(false)} dark={dark}
          structure={structure} onStructureChange={changeStructure} />}
        {error && (
          <div className={`absolute inset-0 flex items-center justify-center ${dark ? "bg-[#131722]/80" : "bg-white/80"}`}>
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle size={16} /> {error}
            </div>
          </div>
        )}
        {empty && (
          <div className={`absolute inset-0 flex items-center justify-center ${dark ? "bg-[#131722]/80" : "bg-white/80"}`}>
            <div className={`flex flex-col items-center gap-3 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <span>No {tf} bars stored for {symbol} in this range.</span>
              <button onClick={fetchMissing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
                <Download size={13} /> Fetch data
              </button>
            </div>
          </div>
        )}
      </div>
      {replay.active && (
        <>
          <ReplayControls replay={replay} dark={dark} onExit={exitReplay} price={price}
            label={bars[replay.cursor]?.date.replace("T", " ").slice(0, 16).replace(/ 00:00$/, "") ?? ""} />
          {price !== undefined && <OrderCards price={price} dark={dark} positions={positions} settings={settings} onPlace={placeTrade}
            onSettings={(ins, next) => setSettings((prev) => ({ ...prev, [ins]: next }))} onLevels={moveLevels} />}
        </>
      )}
      </div>
      {plotMode && !replay.active && (
        <aside className={`w-80 shrink-0 border-l ${dark ? "border-[#2a2e39]" : "border-slate-200"}`}>
          <TradePlotPanel plots={tradePlots.plots} loading={tradePlots.loading} error={tradePlots.error} selectedId={selectedPlot} dark={dark}
            onSelect={setSelectedPlot} onJump={jumpToPlot} onChange={tradePlots.update}
            onDelete={(id) => { void tradePlots.remove(id); setSelectedPlot((cur) => (cur === id ? null : cur)); }} />
        </aside>
      )}
      {replay.active && (
        <aside className={`w-96 shrink-0 border-l ${dark ? "border-[#2a2e39]" : "border-slate-200"}`}>
          <TradePanel trades={trades} bars={bars} cursor={replay.cursor} dark={dark} positions={positions} onClose={closeTrade}
            onCloseAll={() => setTrades((prev) => closeAll(prev, bars, replay.cursor))} />
        </aside>
      )}
      </div>
    </div>
  );
}
