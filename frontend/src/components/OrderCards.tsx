import { useState } from "react";
import {
  buildOrder, fieldToLevel, fieldToTrail, levelToField, trailToField, validateLevel, type CardSettings,
} from "../lib/orderSettings";
import type { Instrument, LevelUnit, Order, Position, Side } from "../lib/paperTrading";
import { price as fmtPrice } from "../lib/formatTrade";

interface Props {
  /** Close of the newest revealed candle: the price a market order fills at. */
  price: number;
  dark: boolean;
  /** Open positions, with any line being dragged on the chart already applied. */
  positions: Record<Instrument, Position | null>;
  settings: Record<Instrument, CardSettings>;
  onSettings: (instrument: Instrument, next: CardSettings) => void;
  /** Move the stop-loss and / or target of an open position (null removes one). */
  onLevels: (instrument: Instrument, changes: { stopLoss?: number | null; target?: number | null; trail?: number | null }) => void;
  onPlace: (order: Order) => void;
}

const COPY: Record<Instrument, { title: string; hint: string }> = {
  CE: { title: "CE", hint: "Buy gains when the price rises, Sell when it falls" },
  PE: { title: "PE", hint: "Buy gains when the price falls, Sell when it rises" },
};

/**
 * One order card (CE or PE) with its own size, stop-loss and target (points or percent) and a Buy and a Sell button.
 * With no position the fields are the levels the next order will use. With a position open they show its live
 * stop-loss and target, the same ones as the lines on the chart: typing here moves the lines, and dragging a line
 * changes the fields. Levels are on the chart price; a PE moves against the chart, so Buy PE gains when it falls.
 */
function OrderCard({ instrument, price, dark, positions, settings, onSettings, onLevels, onPlace }: Props & { instrument: Instrument }) {
  const holding = positions[instrument];
  const s = settings[instrument];
  const [draft, setDraft] = useState<{ stoploss: string | null; target: string | null; trail: string | null }>({ stoploss: null, target: null, trail: null });
  const [error, setError] = useState("");

  const unitOf = (kind: "stoploss" | "target") => (kind === "stoploss" ? s.slUnit : s.tpUnit);
  const fieldValue = (kind: "stoploss" | "target") =>
    holding ? (draft[kind] ?? levelToField(holding, kind, unitOf(kind))) : (kind === "stoploss" ? s.slValue : s.tpValue);

  const edit = (kind: "stoploss" | "target", text: string) => {
    if (!holding) {
      onSettings(instrument, kind === "stoploss" ? { ...s, slValue: text } : { ...s, tpValue: text });
      return;
    }
    setDraft((d) => ({ ...d, [kind]: text }));
    const level = fieldToLevel(holding, kind, text, unitOf(kind));
    if (level === undefined) { setError("Type a number."); return; }
    const problem = level === null ? null : validateLevel(holding.direction, price, kind, level);
    if (problem) { setError(problem); return; }
    setError("");
    if (kind === "target") { onLevels(instrument, { target: level }); return; }
    // While a trail is on, a stop-loss set by hand keeps trailing from there: the gap to the price becomes the trail
    if (holding.trail !== null) {
      onLevels(instrument, level === null ? { stopLoss: null, trail: null } : { stopLoss: level, trail: (price - level) * holding.direction });
    } else {
      onLevels(instrument, { stopLoss: level });
    }
  };

  const trailValue = holding ? (draft.trail ?? trailToField(holding, s.trailUnit)) : s.trailValue;
  const editTrail = (text: string) => {
    if (!holding) { onSettings(instrument, { ...s, trailValue: text }); return; }
    setDraft((d) => ({ ...d, trail: text }));
    const distance = fieldToTrail(holding, text, s.trailUnit);
    if (distance === undefined) { setError("The trail must be a number above 0, or empty to turn it off."); return; }
    setError("");
    onLevels(instrument, { trail: distance });
  };

  const changeUnit = (kind: "stoploss" | "target", unit: LevelUnit) => {
    setDraft((d) => ({ ...d, [kind]: null }));
    onSettings(instrument, kind === "stoploss" ? { ...s, slUnit: unit } : { ...s, tpUnit: unit });
  };

  const changeTrailUnit = (unit: LevelUnit) => {
    setDraft((d) => ({ ...d, trail: null }));
    onSettings(instrument, { ...s, trailUnit: unit });
  };

  const place = (side: Side) => {
    const built = buildOrder(instrument, side, s, price, holding);
    if ("error" in built) { setError(built.error); return; }
    setError("");
    onPlace(built.order);
  };

  /** One line of text under the fields saying what a press of Buy or Sell would do. */
  const preview = (side: Side) => {
    const word = side === "buy" ? "Buy" : "Sell";
    const built = buildOrder(instrument, side, s, price, holding);
    if ("error" in built) return null;
    const { qty } = built.order;
    if (holding && holding.side !== side) {
      const closes = Math.min(qty, holding.qty);
      return `${word}: books ${closes} of your ${holding.qty}${qty > closes ? `, ${qty - closes} opens a new trade` : ""}`;
    }
    if (holding) return `${word}: adds ${qty}, with the position's stop-loss and target`;
    const { stopLoss, target, trail } = built.order;
    if (stopLoss === null && target === null && !trail) return null;
    return `${word}: ${stopLoss !== null ? `SL ${fmtPrice(stopLoss)}` : "no SL"} · ${target !== null ? `TP ${fmtPrice(target)}` : "no TP"}${trail ? ` · trail ${fmtPrice(trail)}` : ""}`;
  };
  const previews = [preview("buy"), preview("sell")].filter(Boolean);

  const card = dark ? "bg-[#1e222d] border-[#2a2e39]" : "bg-slate-50 border-slate-200";
  const border = instrument === "CE" ? "border-l-emerald-500" : "border-l-red-500";
  const field = `w-16 px-1.5 py-1 rounded border text-xs text-right ${
    dark ? "bg-[#131722] border-[#2a2e39] text-slate-200" : "bg-white border-slate-200 text-slate-700"
  }`;
  const unitCls = `px-1 py-1 rounded border text-xs ${dark ? "bg-[#131722] border-[#2a2e39] text-slate-200" : "bg-white border-slate-200 text-slate-700"}`;
  const muted = dark ? "text-slate-400" : "text-slate-500";

  return (
    <div className={`flex-1 min-w-0 rounded-lg border border-l-4 ${border} ${card} px-3 py-2 flex items-center gap-3`}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>{COPY[instrument].title}</span>
          <span className={`text-[11px] ${muted}`}>{COPY[instrument].hint}</span>
          <span className={`ml-auto text-[11px] font-semibold tabular-nums ${holding ? (dark ? "text-blue-400" : "text-blue-600") : muted}`}>
            {holding
              ? `Holding ${holding.qty} ${holding.side === "buy" ? "bought" : "sold"} @ ${fmtPrice(holding.avgPrice)}`
              : "No position"}
          </span>
        </div>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${muted}`}>
          <label className="flex items-center gap-1.5">
            Qty
            <input className={field} type="number" min={1} step={1} value={s.qty} onChange={(e) => onSettings(instrument, { ...s, qty: e.target.value })} />
          </label>
          <label className="flex items-center gap-1.5" title={holding ? "Live stop-loss of the position, same as the red line on the chart" : "Stop-loss for the next order"}>
            Stop-loss
            <input className={field} type="number" step="any" placeholder="none" value={fieldValue("stoploss")}
              onChange={(e) => edit("stoploss", e.target.value)} onBlur={() => setDraft((d) => ({ ...d, stoploss: null }))} />
            <select className={unitCls} value={s.slUnit} onChange={(e) => changeUnit("stoploss", e.target.value as LevelUnit)}>
              <option value="%">%</option><option value="pts">pts</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5" title="The stop-loss follows the best price at this distance and only moves in your favour. Empty = fixed stop-loss.">
            Trail
            <input className={field} type="number" step="any" placeholder="off" value={trailValue}
              onChange={(e) => editTrail(e.target.value)} onBlur={() => setDraft((d) => ({ ...d, trail: null }))} />
            <select className={unitCls} value={s.trailUnit} onChange={(e) => changeTrailUnit(e.target.value as LevelUnit)}>
              <option value="%">%</option><option value="pts">pts</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5" title={holding ? "Live target of the position, same as the green line on the chart" : "Target for the next order"}>
            Target
            <input className={field} type="number" step="any" placeholder="none" value={fieldValue("target")}
              onChange={(e) => edit("target", e.target.value)} onBlur={() => setDraft((d) => ({ ...d, target: null }))} />
            <select className={unitCls} value={s.tpUnit} onChange={(e) => changeUnit("target", e.target.value as LevelUnit)}>
              <option value="%">%</option><option value="pts">pts</option>
            </select>
          </label>
        </div>
        <div className="text-[11px] min-h-4">
          {error ? (
            <span className="text-red-500">{error}</span>
          ) : (
            <span className={muted}>
              {previews.length ? previews.join("   |   ") : "No stop-loss or target: close the trade by hand."}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col gap-1.5">
        <button onClick={() => place("buy")} className="px-6 py-1.5 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700">Buy</button>
        <button onClick={() => place("sell")} className="px-6 py-1.5 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700">Sell</button>
      </div>
    </div>
  );
}

/** The two order cards under the player: CE and PE, each with Buy and Sell. */
export default function OrderCards(props: Props) {
  return (
    <div className={`shrink-0 flex gap-3 px-3 py-2 border-t ${props.dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
      <OrderCard instrument="CE" {...props} />
      <OrderCard instrument="PE" {...props} />
    </div>
  );
}
