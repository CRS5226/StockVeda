// Paper trading for the Charts replay. Everything here is pure: a trade only stores what the user did
// (instrument, side, size, entry, stop-loss, target, and any exits they booked by hand). Whether it is open,
// how much of it is left and what it has booked at a given replay position is worked out from the bars, so
// rewinding and replaying always agree. Orders on an instrument net against what is already open on it:
// selling 3 of a 10-lot buy leaves 7.

export type Side = "buy" | "sell";
/** Call (CE) or put (PE). The chart is the underlying, so a PE moves against it. */
export type Instrument = "CE" | "PE";
export type ExitReason = "target" | "stoploss" | "manual";

/**
 * Which way the trade gains on the chart price: +1 when it gains as the price rises, -1 as it falls.
 * Buy CE and Sell PE gain when the market rises; Sell CE and Buy PE gain when it falls.
 */
export function marketDirection(instrument: Instrument, side: Side): 1 | -1 {
  return (instrument === "CE") === (side === "buy") ? 1 : -1;
}

/** Part (or all) of a trade closed by hand at the close of candle `index`. */
export interface ManualExit { index: number; price: number; qty: number }

/**
 * A change of stop-loss and / or target made at the close of candle `index`. It applies from the next candle.
 * `undefined` leaves a level as it is; `null` removes it.
 */
export interface LevelChange {
  index: number;
  stopLoss?: number | null;
  target?: number | null;
  /** Trailing distance in price points (null = off). */
  trail?: number | null;
}

export interface PaperTrade {
  id: number;
  instrument: Instrument;
  side: Side;
  /** Quantity when the trade was opened. */
  qty: number;
  /** Index (into the loaded bars) of the candle the trade was placed on; filled at that candle's close. */
  entryIndex: number;
  entryPrice: number;
  stopLoss: number | null;
  target: number | null;
  manualExits: ManualExit[];
  /** Trailing stop distance in price points when the trade was opened (null = fixed stop-loss only). */
  trail: number | null;
  /** Changes the user made to the stop-loss / target while the trade was open (dragged on the chart or typed on the card). */
  adjustments: LevelChange[];
}

/** One exit of a trade: a slice of it closed by the user, or what is left of it closed by the stop-loss / target. */
export interface BookedExit { index: number; price: number; qty: number; reason: ExitReason }

export interface Amount { points: number; pct: number; money: number }

export interface TradeState {
  /** pending: placed on a candle after the current replay position (hidden after a rewind). */
  status: "pending" | "open" | "closed";
  /** Quantity still open at the current position. */
  openQty: number;
  /** Every exit so far, in order. */
  exits: BookedExit[];
  /** Result of those exits. `points` and `pct` are averaged over the exited quantity. */
  booked: Amount;
  /** The stop-loss and target in force at the current position (after any changes made so far). */
  stopLoss: number | null;
  target: number | null;
  /** Trailing distance in force (null = off). */
  trail: number | null;
  /** When closed: the exit that closed the last of it. */
  exitIndex: number | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
}

interface Bar { open: number; high: number; low: number; close: number }

const dirOf = (t: PaperTrade) => marketDirection(t.instrument, t.side);

/** Result of closing `qty` of the trade at `price`: points, percent of the entry price, and money. */
export function amountAt(t: PaperTrade, price: number, qty: number = t.qty): Amount {
  const points = (price - t.entryPrice) * dirOf(t);
  return { points, pct: (points / t.entryPrice) * 100, money: points * qty };
}

/** Result of a set of exits: money adds up, points and percent are per unit, averaged by quantity. */
function bookedAmount(t: PaperTrade, exits: BookedExit[]): Amount {
  const qty = exits.reduce((sum, e) => sum + e.qty, 0);
  if (qty === 0) return { points: 0, pct: 0, money: 0 };
  const money = exits.reduce((sum, e) => sum + amountAt(t, e.price, e.qty).money, 0);
  const points = money / qty;
  return { points, pct: (points / t.entryPrice) * 100, money };
}

/**
 * State of a trade when the replay has revealed bars 0..cursor. From the candle after the entry, the
 * stop-loss and target are checked against each candle's high / low and close whatever quantity is still
 * open; if both are inside one candle the stop-loss wins (the pessimistic reading, since the order inside a
 * candle is unknown). A candle that opens beyond a level fills at the open, not at the level. Exits the user
 * booked by hand apply at the close of the candle they were made on, after that candle's own checks.
 */
export function evaluateTrade(t: PaperTrade, bars: Bar[], cursor: number): TradeState {
  if (t.entryIndex > cursor) {
    return {
      status: "pending", openQty: 0, exits: [], booked: { points: 0, pct: 0, money: 0 },
      stopLoss: t.stopLoss, target: t.target, trail: t.trail, exitIndex: null, exitPrice: null, exitReason: null,
    };
  }
  const long = dirOf(t) === 1;
  const exits: BookedExit[] = [];
  let remaining = t.qty;
  // levels in force: the original ones, then each change from the candle after the one it was made on
  let sl = t.stopLoss, tp = t.target, trail = t.trail;
  // best price since entry, for the trailing stop: the highest high of a long, the lowest low of a short
  let extreme = t.entryPrice;
  const changes = [...t.adjustments].sort((a, b) => a.index - b.index);
  let next = 0;
  const applyChanges = (upTo: number) => {
    while (next < changes.length && changes[next].index <= upTo) {
      const c = changes[next++];
      if (c.trail !== undefined) trail = c.trail;
      if (c.target !== undefined) tp = c.target;
      if (c.stopLoss !== undefined) {
        sl = c.stopLoss;
        // a stop set by hand while trailing keeps trailing from there: the best price restarts at that candle's close
        if (trail !== null && bars[c.index]) extreme = bars[c.index].close;
      }
    }
  };
  /** Moves the trailing stop to the best price minus the trail distance, never backwards. */
  const ratchet = () => {
    if (trail === null) return;
    const candidate = long ? extreme - trail : extreme + trail;
    sl = sl === null ? candidate : long ? Math.max(sl, candidate) : Math.min(sl, candidate);
  };
  for (let i = t.entryIndex; i <= cursor && i < bars.length && remaining > 0; i++) {
    if (i === t.entryIndex) {
      ratchet(); // trailing starts right away: the first stop is the entry price minus the trail distance
    } else {
      applyChanges(i - 1);
      const b = bars[i];
      const slHit = sl !== null && (long ? b.low <= sl : b.high >= sl);
      const tpHit = tp !== null && (long ? b.high >= tp : b.low <= tp);
      if (slHit && sl !== null) {
        const gap = long ? b.open <= sl : b.open >= sl;
        exits.push({ index: i, price: gap ? b.open : sl, qty: remaining, reason: "stoploss" });
        remaining = 0;
        break;
      }
      if (tpHit && tp !== null) {
        const gap = long ? b.open >= tp : b.open <= tp;
        exits.push({ index: i, price: gap ? b.open : tp, qty: remaining, reason: "target" });
        remaining = 0;
        break;
      }
      extreme = long ? Math.max(extreme, b.high) : Math.min(extreme, b.low);
      ratchet();
    }
    for (const m of t.manualExits) {
      if (m.index !== i || remaining <= 0) continue;
      const take = Math.min(m.qty, remaining);
      if (take > 0) { exits.push({ index: i, price: m.price, qty: take, reason: "manual" }); remaining -= take; }
    }
  }
  if (remaining > 0) applyChanges(cursor); // changes made on the newest candle show straight away
  const last = exits[exits.length - 1];
  return {
    status: remaining > 0 ? "open" : "closed",
    openQty: remaining,
    exits,
    booked: bookedAmount(t, exits),
    stopLoss: sl,
    target: tp,
    trail,
    exitIndex: remaining === 0 && last ? last.index : null,
    exitPrice: remaining === 0 && last ? last.price : null,
    exitReason: remaining === 0 && last ? last.reason : null,
  };
}

export type LevelUnit = "pts" | "%";

/**
 * Stop-loss or target price from a distance typed in points or percent of the entry. The stop-loss sits
 * against the trade (below the entry when it gains as the price rises, above it when it gains as it
 * falls) and the target with it. `direction` is the trade's market direction.
 */
export function levelFromDistance(direction: 1 | -1, entry: number, kind: "stoploss" | "target", value: number, unit: LevelUnit): number {
  const distance = unit === "%" ? (entry * value) / 100 : value;
  const withTrade = kind === "target" ? direction : -direction;
  return entry + withTrade * distance;
}

/** Reasons a new trade is not allowed, or null when it is fine. */
export function validateOrder(direction: 1 | -1, entry: number, qty: number, stopLoss: number | null, target: number | null): string | null {
  if (!Number.isFinite(entry) || entry <= 0) return "No price to trade at yet.";
  if (!Number.isInteger(qty) || qty < 1) return "Quantity must be a whole number of at least 1.";
  const long = direction === 1; // gains as the chart price rises
  if (stopLoss !== null && (long ? stopLoss >= entry : stopLoss <= entry)) {
    return long ? "This trade loses when the price falls: its stop-loss must be below the entry price." : "This trade loses when the price rises: its stop-loss must be above the entry price.";
  }
  if (target !== null && (long ? target <= entry : target >= entry)) {
    return long ? "This trade gains when the price rises: its target must be above the entry price." : "This trade gains when the price falls: its target must be below the entry price.";
  }
  return null;
}

export interface Order {
  instrument: Instrument; side: Side; qty: number; stopLoss: number | null; target: number | null;
  /** Trailing distance in price points; omitted or null = no trail. */
  trail?: number | null;
}

export interface Position {
  instrument: Instrument;
  /** The side that is open on the instrument: what the user bought or sold. */
  side: Side;
  /** Which way the position gains on the chart price (+1 rises, -1 falls). */
  direction: 1 | -1;
  qty: number;
  /** Average entry price of the open quantity. */
  avgPrice: number;
  /** One stop-loss and target for the whole position (new orders on it adopt them). */
  stopLoss: number | null;
  target: number | null;
  /** Trailing distance in price points (null = off). */
  trail: number | null;
  /** Result of the open quantity at the latest close, in money. */
  floating: number;
}

/** What is open on one instrument at the current position, or null. FIFO netting keeps it to one side. */
export function positionOf(trades: PaperTrade[], bars: Bar[], cursor: number, instrument: Instrument): Position | null {
  let qty = 0, cost = 0, floating = 0, side: Side | null = null;
  let stopLoss: number | null = null, target: number | null = null, trail: number | null = null;
  const mark = bars[Math.min(cursor, bars.length - 1)]?.close;
  for (const t of trades) {
    if (t.instrument !== instrument) continue;
    const s = evaluateTrade(t, bars, cursor);
    if (s.status !== "open") continue;
    if (side === null) { stopLoss = s.stopLoss; target = s.target; trail = s.trail; } // the levels of the oldest open trade stand for the position
    side = t.side;
    qty += s.openQty;
    cost += s.openQty * t.entryPrice;
    if (mark !== undefined) floating += amountAt(t, mark, s.openQty).money;
  }
  return side && qty > 0
    ? { instrument, side, direction: marketDirection(instrument, side), qty, avgPrice: cost / qty, stopLoss, target, trail, floating }
    : null;
}

export interface PlaceResult {
  trades: PaperTrade[];
  /** Part of the order that closed trades already open on the instrument (the oldest first). */
  closedQty: number;
  /** Part of the order that opened a new trade. */
  openedQty: number;
}

/**
 * Places a market order at the close of candle `cursor`. It first closes the open trades of the opposite
 * side on the same instrument, oldest first (selling 3 of a 10-lot buy leaves 7); only what is left of the
 * order opens a new trade, with the given stop-loss and target.
 */
export function placeOrder(trades: PaperTrade[], order: Order, bars: Bar[], cursor: number, newId: number): PlaceResult {
  const price = bars[cursor].close;
  let need = order.qty;
  const next = trades.map((t) => ({ ...t }));
  const opposite = next
    .filter((t) => t.instrument === order.instrument && t.side !== order.side)
    .sort((a, b) => a.entryIndex - b.entryIndex || a.id - b.id);
  for (const t of opposite) {
    if (need <= 0) break;
    const open = evaluateTrade(t, bars, cursor).openQty;
    const take = Math.min(open, need);
    if (take > 0) {
      t.manualExits = [...t.manualExits, { index: cursor, price, qty: take }];
      need -= take;
    }
  }
  if (need > 0) {
    // Adding to a position keeps its stop-loss and target (one pair per instrument); a fresh position takes the order's.
    const held = positionOf(trades, bars, cursor, order.instrument);
    const adopt = held && held.side === order.side;
    next.push({
      id: newId, instrument: order.instrument, side: order.side, qty: need, entryIndex: cursor, entryPrice: price,
      stopLoss: adopt ? held.stopLoss : order.stopLoss, target: adopt ? held.target : order.target,
      trail: adopt ? held.trail : (order.trail ?? null), manualExits: [], adjustments: [],
    });
  }
  return { trades: next, closedQty: order.qty - need, openedQty: need };
}

/**
 * Moves the stop-loss, target and / or trailing distance of everything open on an instrument, from the candle
 * after `cursor`. `null` removes one. Changes made on the same candle merge instead of piling up while a line is dragged.
 */
export function adjustLevels(
  trades: PaperTrade[], instrument: Instrument, changes: { stopLoss?: number | null; target?: number | null; trail?: number | null },
  bars: Bar[], cursor: number,
): PaperTrade[] {
  return trades.map((t) => {
    if (t.instrument !== instrument || evaluateTrade(t, bars, cursor).status !== "open") return t;
    const last = t.adjustments[t.adjustments.length - 1];
    const adjustments = last && last.index === cursor
      ? [...t.adjustments.slice(0, -1), { ...last, ...changes }]
      : [...t.adjustments, { index: cursor, ...changes }];
    return { ...t, adjustments };
  });
}

/** Books `qty` (at most what is open) of an instrument's position at market, the way the box on the entry line does. */
export function closePosition(trades: PaperTrade[], instrument: Instrument, qty: number, bars: Bar[], cursor: number): PaperTrade[] {
  const held = positionOf(trades, bars, cursor, instrument);
  if (!held) return trades;
  const take = Math.min(Math.floor(qty), held.qty);
  if (take < 1) return trades;
  return placeOrder(trades, { instrument, side: held.side === "buy" ? "sell" : "buy", qty: take, stopLoss: null, target: null }, bars, cursor, -1).trades;
}

/** Closes everything that is open, on both instruments. */
export function closeAll(trades: PaperTrade[], bars: Bar[], cursor: number): PaperTrade[] {
  return trades.reduce((acc, t) => closeTradeAtMarket(acc, t.id, bars, cursor), trades);
}

/** Closes everything still open on a trade at the close of candle `cursor`. */
export function closeTradeAtMarket(trades: PaperTrade[], id: number, bars: Bar[], cursor: number): PaperTrade[] {
  const price = bars[cursor].close;
  return trades.map((t) => {
    if (t.id !== id) return t;
    const open = evaluateTrade(t, bars, cursor).openQty;
    return open > 0 ? { ...t, manualExits: [...t.manualExits, { index: cursor, price, qty: open }] } : t;
  });
}

export interface Summary {
  total: number;
  open: number;
  closed: number;
  wins: number;
  winRate: number | null;
  /** Result of every exit so far, including the parts booked out of trades that are still open. */
  booked: Amount;
  /** Result of the open quantity marked at the latest close. */
  floating: Amount;
}

export function summarize(trades: PaperTrade[], bars: Bar[], cursor: number): Summary {
  const out: Summary = {
    total: 0, open: 0, closed: 0, wins: 0, winRate: null,
    booked: { points: 0, pct: 0, money: 0 }, floating: { points: 0, pct: 0, money: 0 },
  };
  const mark = bars[Math.min(cursor, bars.length - 1)]?.close;
  for (const t of trades) {
    const s = evaluateTrade(t, bars, cursor);
    if (s.status === "pending") continue;
    out.total++;
    out.booked.money += s.booked.money;
    out.booked.points += s.booked.points;
    out.booked.pct += s.booked.pct;
    if (s.status === "closed") {
      out.closed++;
      if (s.booked.money > 0) out.wins++;
    } else if (mark !== undefined) {
      const a = amountAt(t, mark, s.openQty);
      out.open++;
      out.floating.points += a.points;
      out.floating.money += a.money;
      out.floating.pct += a.pct;
    }
  }
  out.winRate = out.closed ? (out.wins / out.closed) * 100 : null;
  return out;
}
