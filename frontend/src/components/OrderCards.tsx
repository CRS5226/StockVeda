import { useState } from "react";
import { levelFromDistance, marketDirection, validateOrder, type Instrument, type LevelUnit, type Position, type Side } from "../lib/paperTrading";
import { price as fmtPrice } from "../lib/formatTrade";

export interface OrderInput { instrument: Instrument; side: Side; qty: number; stopLoss: number | null; target: number | null }

interface Props {
  /** Close of the newest revealed candle: the price a market order fills at. */
  price: number;
  dark: boolean;
  /** What is open on each instrument right now. */
  positions: Record<Instrument, Position | null>;
  onPlace: (order: OrderInput) => void;
}

// A new card opens with a 1% stop-loss and a 2% target; clear a field to place the order without it.
const DEFAULT_STOPLOSS_PCT = "1";
const DEFAULT_TARGET_PCT = "2";

const COPY: Record<Instrument, { title: string; hint: string }> = {
  CE: { title: "CE", hint: "Buy gains when the price rises, Sell when it falls" },
  PE: { title: "PE", hint: "Buy gains when the price falls, Sell when it rises" },
};

/**
 * One order card (CE or PE) with its own size, stop-loss and target (points or percent from the entry) and a
 * Buy and a Sell button. Levels are on the chart price; a PE moves against the chart, so Buy PE gains when it falls.
 */
function OrderCard({ instrument, price, dark, positions, onPlace }: Props & { instrument: Instrument }) {
  const holding = positions[instrument];
  const [qty, setQty] = useState("1");
  const [slValue, setSlValue] = useState(DEFAULT_STOPLOSS_PCT);
  const [slUnit, setSlUnit] = useState<LevelUnit>("%");
  const [tpValue, setTpValue] = useState(DEFAULT_TARGET_PCT);
  const [tpUnit, setTpUnit] = useState<LevelUnit>("%");
  const [error, setError] = useState("");

  const parse = (v: string) => (v.trim() === "" ? null : Number(v));
  const valid = (n: number | null) => n === null || (Number.isFinite(n) && n > 0);
  const levels = (side: Side) => {
    const direction = marketDirection(instrument, side);
    const sl = parse(slValue), tp = parse(tpValue);
    return {
      direction,
      stopLoss: sl !== null && valid(sl) ? levelFromDistance(direction, price, "stoploss", sl, slUnit) : null,
      target: tp !== null && valid(tp) ? levelFromDistance(direction, price, "target", tp, tpUnit) : null,
    };
  };

  /** How much of an order on `side` closes what is open on the opposite side, and how much opens something new. */
  const split = (side: Side) => {
    const n = Number(qty);
    const open = holding && holding.side !== side ? holding.qty : 0;
    const closes = Number.isInteger(n) && n > 0 ? Math.min(n, open) : 0;
    return { n, open, closes, extra: Number.isInteger(n) ? n - closes : n };
  };

  const place = (side: Side) => {
    if (!valid(parse(slValue)) || !valid(parse(tpValue))) {
      setError("Stop-loss and target distances must be numbers above 0.");
      return;
    }
    const { direction, stopLoss, target } = levels(side);
    const { n, extra } = split(side);
    // the levels only apply to a new trade; an order that just books part of a holding needs none
    const problem = extra > 0 ? validateOrder(direction, price, n, stopLoss, target) : validateOrder(direction, price, n, null, null);
    if (problem) { setError(problem); return; }
    setError("");
    onPlace({ instrument, side, qty: n, stopLoss: extra > 0 ? stopLoss : null, target: extra > 0 ? target : null });
  };

  const preview = (side: Side) => {
    const word = side === "buy" ? "Buy" : "Sell";
    const { open, closes, extra } = split(side);
    if (open > 0 && closes > 0) {
      return `${word}: books ${closes} of your ${open}${extra > 0 ? `, ${extra} opens a new trade` : ""}`;
    }
    const { stopLoss, target } = levels(side);
    if (stopLoss === null && target === null) return null;
    return `${word}: ${stopLoss !== null ? `SL ${fmtPrice(stopLoss)}` : "no SL"} · ${target !== null ? `TP ${fmtPrice(target)}` : "no TP"}`;
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
            <input className={field} type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5">
            Stop-loss
            <input className={field} type="number" min={0} step="any" placeholder="none" value={slValue} onChange={(e) => setSlValue(e.target.value)} />
            <select className={unitCls} value={slUnit} onChange={(e) => setSlUnit(e.target.value as LevelUnit)}>
              <option value="%">%</option><option value="pts">pts</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Target
            <input className={field} type="number" min={0} step="any" placeholder="none" value={tpValue} onChange={(e) => setTpValue(e.target.value)} />
            <select className={unitCls} value={tpUnit} onChange={(e) => setTpUnit(e.target.value as LevelUnit)}>
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
export default function OrderCards({ price, dark, positions, onPlace }: Props) {
  return (
    <div className={`shrink-0 flex gap-3 px-3 py-2 border-t ${dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
      <OrderCard instrument="CE" price={price} dark={dark} positions={positions} onPlace={onPlace} />
      <OrderCard instrument="PE" price={price} dark={dark} positions={positions} onPlace={onPlace} />
    </div>
  );
}
