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
    return { status: "pending", openQty: 0, exits: [], booked: { points: 0, pct: 0, money: 0 }, exitIndex: null, exitPrice: null, exitReason: null };
  }
  const long = dirOf(t) === 1;
  const exits: BookedExit[] = [];
  let remaining = t.qty;
  for (let i = t.entryIndex; i <= cursor && i < bars.length && remaining > 0; i++) {
    if (i > t.entryIndex) {
      const b = bars[i];
      const slHit = t.stopLoss !== null && (long ? b.low <= t.stopLoss : b.high >= t.stopLoss);
      const tpHit = t.target !== null && (long ? b.high >= t.target : b.low <= t.target);
      if (slHit && t.stopLoss !== null) {
        const gap = long ? b.open <= t.stopLoss : b.open >= t.stopLoss;
        exits.push({ index: i, price: gap ? b.open : t.stopLoss, qty: remaining, reason: "stoploss" });
        remaining = 0;
        break;
      }
      if (tpHit && t.target !== null) {
        const gap = long ? b.open >= t.target : b.open <= t.target;
        exits.push({ index: i, price: gap ? b.open : t.target, qty: remaining, reason: "target" });
        remaining = 0;
        break;
      }
    }
    for (const m of t.manualExits) {
      if (m.index !== i || remaining <= 0) continue;
      const take = Math.min(m.qty, remaining);
      if (take > 0) { exits.push({ index: i, price: m.price, qty: take, reason: "manual" }); remaining -= take; }
    }
  }
  const last = exits[exits.length - 1];
  return {
    status: remaining > 0 ? "open" : "closed",
    openQty: remaining,
    exits,
    booked: bookedAmount(t, exits),
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

export interface Order { instrument: Instrument; side: Side; qty: number; stopLoss: number | null; target: number | null }

export interface Position {
  /** The side that is open on the instrument: what the user bought or sold. */
  side: Side;
  qty: number;
  /** Average entry price of the open quantity. */
  avgPrice: number;
}

/** What is open on one instrument at the current position, or null. FIFO netting keeps it to one side. */
export function positionOf(trades: PaperTrade[], bars: Bar[], cursor: number, instrument: Instrument): Position | null {
  let qty = 0, cost = 0, side: Side | null = null;
  for (const t of trades) {
    if (t.instrument !== instrument) continue;
    const s = evaluateTrade(t, bars, cursor);
    if (s.status !== "open") continue;
    side = t.side;
    qty += s.openQty;
    cost += s.openQty * t.entryPrice;
  }
  return side && qty > 0 ? { side, qty, avgPrice: cost / qty } : null;
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
    next.push({
      id: newId, instrument: order.instrument, side: order.side, qty: need, entryIndex: cursor, entryPrice: price,
      stopLoss: order.stopLoss, target: order.target, manualExits: [],
    });
  }
  return { trades: next, closedQty: order.qty - need, openedQty: need };
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
