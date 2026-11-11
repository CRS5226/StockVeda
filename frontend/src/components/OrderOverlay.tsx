import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { Plus, X } from "lucide-react";
import { clampLevel } from "../lib/orderSettings";
import { money, percent, price as fmt, tone } from "../lib/formatTrade";
import type { Instrument, Position } from "../lib/paperTrading";

type Kind = "stoploss" | "target";
const INSTRUMENTS: Instrument[] = ["CE", "PE"];
const ENTRY = "#3b82f6", SL = "#ef4444", TP = "#22c55e";

interface Props {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  /** Open positions, with any line being dragged already applied. */
  positions: Record<Instrument, Position | null>;
  /** Close of the newest revealed candle: where an order from the menu fills. */
  price: number;
  dark: boolean;
  /** What a new order on each instrument uses for its levels, for the quantity box. */
  summary: Record<Instrument, string>;
  onDrag: (instrument: Instrument, kind: Kind, level: number) => void;
  onDrop: (instrument: Instrument, kind: Kind, level: number) => void;
  /** Book `qty` of the position at market. */
  onExit: (instrument: Instrument, qty: number) => void;
  /** Buy from the menu. Returns an error message, or null when the order went through. */
  onBuy: (instrument: Instrument, qty: number) => string | null;
}

interface Geometry { width: number; paneHeight: number; axis: number; ys: (number | null)[] }

/** Screen positions of the given prices, refreshed every frame so lines follow zoom, scroll and price-axis changes. */
function useGeometry(chart: IChartApi, series: ISeriesApi<"Candlestick">, prices: (number | null)[]): Geometry {
  const [geo, setGeo] = useState<Geometry>({ width: 0, paneHeight: 0, axis: 0, ys: [] });
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      try {
        const next: Geometry = {
          width: chart.chartElement().clientWidth,
          paneHeight: chart.paneSize().height,
          axis: series.priceScale().width(),
          ys: pricesRef.current.map((p) => (p === null ? null : series.priceToCoordinate(p))),
        };
        setGeo((prev) =>
          prev.width === next.width && prev.paneHeight === next.paneHeight && prev.axis === next.axis
          && prev.ys.length === next.ys.length
          && prev.ys.every((y, i) => (y === null ? next.ys[i] === null : next.ys[i] !== null && Math.abs(y - (next.ys[i] as number)) < 0.5))
            ? prev : next);
        frame = requestAnimationFrame(tick);
      } catch {
        /* the chart was torn down: stop */
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [chart, series]);
  return geo;
}

/**
 * Order lines drawn over the chart, like a live trading screen: for each open position an entry line with a box
 * (quantity to exit and an exit button), draggable stop-loss and target lines, and a "+" on the price axis that
 * opens a Buy CE / Buy PE menu. Everything is a page element on top of the chart, so it needs no canvas drawing and
 * the chart does not pan while a line is being dragged.
 */
export default function OrderOverlay({ chart, series, positions, price, dark, summary, onDrag, onDrop, onExit, onBuy }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ instrument: Instrument; kind: Kind; level: number | null } | null>(null);
  const [exitText, setExitText] = useState<Partial<Record<Instrument, string>>>({});
  const [plus, setPlus] = useState<number | null>(null);
  const [popup, setPopup] = useState<{ step: "menu" | "qty"; y: number; instrument?: Instrument } | null>(null);
  const [qty, setQty] = useState("1");
  const [error, setError] = useState("");
  const overPlus = useRef(false);
  const popupOpen = useRef(false);
  popupOpen.current = popup !== null;

  // entry, stop-loss and target for CE then PE
  const prices = INSTRUMENTS.flatMap((i) => {
    const p = positions[i];
    return p ? [p.avgPrice, p.stopLoss, p.target] : [null, null, null];
  });
  const geo = useGeometry(chart, series, prices);
  const paneWidth = Math.max(0, geo.width - geo.axis);

  // "+" next to the price axis, following the mouse
  useEffect(() => {
    const el = chart.chartElement();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (e: MouseEvent) => {
      if (popupOpen.current) return;
      clearTimeout(timer);
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const near = x >= el.clientWidth - series.priceScale().width() - 40 && y >= 0 && y <= chart.paneSize().height;
      setPlus(near ? y : null);
    };
    const leave = () => {
      timer = setTimeout(() => { if (!overPlus.current && !popupOpen.current) setPlus(null); }, 150);
    };
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => { clearTimeout(timer); el.removeEventListener("mousemove", move); el.removeEventListener("mouseleave", leave); };
  }, [chart, series]);

  // close the menu / quantity box on a click elsewhere or Escape
  useEffect(() => {
    if (!popup) return;
    const down = (e: PointerEvent) => { if (!popupRef.current?.contains(e.target as Node)) closePopup(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closePopup(); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [popup]);

  const closePopup = () => { setPopup(null); setPlus(null); setError(""); };

  const startDrag = (e: React.PointerEvent, instrument: Instrument, kind: Kind) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { instrument, kind, level: null };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const pos = d && positions[d.instrument];
    if (!d || !pos || !rootRef.current) return;
    const raw = series.coordinateToPrice(e.clientY - rootRef.current.getBoundingClientRect().top);
    if (raw === null) return;
    d.level = clampLevel(pos.direction, price, d.kind, raw);
    onDrag(d.instrument, d.kind, d.level);
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.level !== null) onDrop(d.instrument, d.kind, d.level);
  };

  const submitBuy = () => {
    if (!popup?.instrument) return;
    const n = Number(qty);
    const problem = Number.isInteger(n) && n >= 1 ? onBuy(popup.instrument, n) : "Quantity must be a whole number of at least 1.";
    if (problem) { setError(problem); return; }
    closePopup();
  };

  const box = dark ? "bg-[#1e222d] border-[#2a2e39] text-slate-200" : "bg-white border-slate-300 text-slate-700";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const input = `px-1.5 py-1 rounded border text-xs text-right ${dark ? "bg-[#131722] border-[#2a2e39] text-slate-200" : "bg-white border-slate-300 text-slate-700"}`;
  const clampY = (y: number) => Math.max(12, Math.min(geo.paneHeight - 12, y));

  const hLine = (y: number, color: string, dashed: boolean) => (
    <div className="absolute left-0" style={{ top: y, width: paneWidth, height: 0, borderTop: `1px ${dashed ? "dashed" : "solid"} ${color}` }} />
  );

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 10 }}>
      {INSTRUMENTS.map((ins, k) => {
        const pos = positions[ins];
        const [entryY, slY, tpY] = geo.ys.slice(k * 3, k * 3 + 3);
        if (!pos || entryY === null || entryY === undefined) return null;
        const buy = pos.side === "buy";
        const exitQty = exitText[ins] ?? String(pos.qty);

        const levelPill = (kind: Kind, level: number | null, y: number | null | undefined) => {
          if (level === null || y === null || y === undefined) return null;
          const points = (level - pos.avgPrice) * pos.direction;
          const result = points * pos.qty;
          const color = kind === "stoploss" ? SL : TP;
          return (
            <>
              {hLine(clampY(y), color, false)}
              {/* wide invisible strip so the line is easy to grab */}
              <div className="absolute left-0 pointer-events-auto cursor-ns-resize" style={{ top: clampY(y) - 6, width: paneWidth, height: 12 }}
                onPointerDown={(e) => startDrag(e, ins, kind)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
              <div className={`absolute pointer-events-auto cursor-ns-resize select-none flex items-center gap-2 rounded border border-l-4 px-2 py-0.5 text-[11px] tabular-nums ${box}`}
                style={{ left: 8, top: clampY(y) - 11, borderLeftColor: color }}
                onPointerDown={(e) => startDrag(e, ins, kind)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <span className="font-bold" style={{ color }}>{ins} {kind === "stoploss" ? "SL" : "TP"}</span>
                <span>{fmt(level)}</span>
                <span className={tone(result, dark)}>{percent((points / pos.avgPrice) * 100)}</span>
                <span className={tone(result, dark)}>{money(result)}</span>
              </div>
            </>
          );
        };

        return (
          <div key={ins}>
            {levelPill("target", pos.target, tpY)}
            {levelPill("stoploss", pos.stopLoss, slY)}
            {hLine(clampY(entryY), ENTRY, true)}
            <div className={`absolute pointer-events-auto select-none flex items-center gap-2 rounded border border-l-4 px-2 py-0.5 text-[11px] tabular-nums ${box}`}
              style={{ left: 8, top: clampY(entryY) - 12, borderLeftColor: ENTRY }}>
              <span className={`font-bold ${buy ? "text-emerald-500" : "text-red-500"}`}>{buy ? "BUY" : "SELL"} {ins}</span>
              <span>{pos.qty} @ {fmt(pos.avgPrice)}</span>
              <span className={`font-semibold ${tone(pos.floating, dark)}`}>{money(pos.floating)}</span>
              <input className={`${input} w-12`} type="number" min={1} max={pos.qty} step={1} value={exitQty} title="Quantity to exit"
                onChange={(e) => setExitText((t) => ({ ...t, [ins]: e.target.value }))} />
              <button title={`Exit ${exitQty} at market`} onClick={() => {
                const n = Math.floor(Number(exitQty));
                onExit(ins, Number.isFinite(n) && n >= 1 ? n : pos.qty);
                setExitText((t) => ({ ...t, [ins]: undefined }));
              }} className={`p-0.5 rounded ${dark ? "hover:bg-[#2a2e39]" : "hover:bg-slate-100"}`}>
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {plus !== null && !popup && (
        <button className={`absolute pointer-events-auto flex items-center justify-center rounded-full border shadow ${box}`}
          style={{ left: paneWidth - 30, top: plus - 11, width: 22, height: 22 }}
          title="Place an order"
          onPointerEnter={() => { overPlus.current = true; }} onPointerLeave={() => { overPlus.current = false; if (!popupOpen.current) setPlus(null); }}
          onClick={() => setPopup({ step: "menu", y: plus })}>
          <Plus size={14} />
        </button>
      )}

      {popup && (
        <div ref={popupRef} className={`absolute pointer-events-auto z-30 rounded-lg border shadow-xl text-xs ${box}`}
          style={{ right: geo.axis + 40, top: Math.max(4, Math.min(geo.paneHeight - 150, popup.y - 40)), width: 230 }}>
          {popup.step === "menu" ? (
            <div className="py-1">
              <div className={`px-3 py-1 text-[11px] ${muted}`}>Place an order at market, {fmt(price)}</div>
              {INSTRUMENTS.map((ins) => (
                <button key={ins} onClick={() => { setPopup({ step: "qty", y: popup.y, instrument: ins }); setQty("1"); setError(""); }}
                  className={`w-full text-left px-3 py-2 font-medium flex items-center gap-2 ${dark ? "hover:bg-[#2a2e39]" : "hover:bg-slate-100"}`}>
                  <span className="text-emerald-500 font-bold">Buy</span> {ins}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3 space-y-2">
              <div className="font-semibold"><span className="text-emerald-500">Buy</span> {popup.instrument} at market, {fmt(price)}</div>
              <div className={muted}>
                {popup.instrument ? summary[popup.instrument] : ""}
              </div>
              <label className="flex items-center gap-2">
                Quantity
                <input className={`${input} w-20`} type="number" min={1} step={1} value={qty} autoFocus
                  onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitBuy(); }} />
              </label>
              {error && <div className="text-red-500">{error}</div>}
              <div className="flex gap-2 justify-end">
                <button onClick={closePopup} className={`px-3 py-1 rounded border ${dark ? "border-[#2a2e39] hover:bg-[#2a2e39]" : "border-slate-300 hover:bg-slate-100"}`}>Cancel</button>
                <button onClick={submitBuy} className="px-4 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700">OK</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
