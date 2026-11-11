import { describe, expect, it } from "vitest";
import {
  adjustLevels, amountAt, closeAll, closePosition, closeTradeAtMarket, evaluateTrade, levelFromDistance, marketDirection,
  placeOrder, positionOf, summarize, validateOrder, type PaperTrade,
} from "./paperTrading";

// A bar is [open, high, low, close].
type Bar = [number, number, number, number];
const bars = (rows: Bar[]) => rows.map(([open, high, low, close]) => ({ open, high, low, close }));
const START: Bar[] = [[100, 101, 99, 100], [100, 101, 99, 100]];

const buy = (over: Partial<PaperTrade> = {}): PaperTrade => ({
  id: 1, instrument: "CE", side: "buy", qty: 10, entryIndex: 1, entryPrice: 100, stopLoss: 95, target: 110, manualExits: [], adjustments: [], ...over,
});

const FLAT = bars([
  [100, 101, 99, 100],
  [100, 101, 99, 100],   // entry candle (index 1)
  [100, 103, 98, 102],
  [102, 106, 101, 105],
]);

describe("evaluateTrade", () => {
  it("is pending before the entry candle is revealed, open after it", () => {
    expect(evaluateTrade(buy(), FLAT, 0).status).toBe("pending");
    expect(evaluateTrade(buy(), FLAT, 1)).toMatchObject({ status: "open", openQty: 10 });
    expect(evaluateTrade(buy(), FLAT, 3).status).toBe("open");
  });

  it("closes at the target when a later high reaches it", () => {
    const b = bars([...START, [100, 111, 99, 108]]);
    expect(evaluateTrade(buy(), b, 2)).toMatchObject({ status: "closed", exitIndex: 2, exitPrice: 110, exitReason: "target", openQty: 0 });
  });

  it("closes at the stop-loss when a later low reaches it", () => {
    const b = bars([...START, [100, 101, 94, 96]]);
    expect(evaluateTrade(buy(), b, 2)).toMatchObject({ status: "closed", exitIndex: 2, exitPrice: 95, exitReason: "stoploss" });
  });

  it("takes the stop-loss when one candle touches both levels", () => {
    const b = bars([...START, [100, 112, 90, 100]]);
    expect(evaluateTrade(buy(), b, 2).exitReason).toBe("stoploss");
  });

  it("fills at the open when a candle gaps past a level", () => {
    const down = bars([...START, [90, 92, 88, 91]]);
    expect(evaluateTrade(buy(), down, 2)).toMatchObject({ exitReason: "stoploss", exitPrice: 90 });
    const up = bars([...START, [115, 118, 114, 116]]);
    expect(evaluateTrade(buy(), up, 2)).toMatchObject({ exitReason: "target", exitPrice: 115 });
  });

  it("does not check the entry candle itself", () => {
    const b = bars([[100, 101, 99, 100], [100, 200, 1, 100]]); // wild entry candle, but the fill is at its close
    expect(evaluateTrade(buy(), b, 1).status).toBe("open");
  });

  it("mirrors for a sell", () => {
    const sell = buy({ side: "sell", stopLoss: 105, target: 90 });
    const tp = bars([...START, [100, 101, 89, 92]]);
    expect(evaluateTrade(sell, tp, 2)).toMatchObject({ exitReason: "target", exitPrice: 90 });
    const sl = bars([...START, [100, 106, 99, 104]]);
    expect(evaluateTrade(sell, sl, 2)).toMatchObject({ exitReason: "stoploss", exitPrice: 105 });
  });

  it("gives the same answer after a rewind and replay", () => {
    const b = bars([...START, [100, 111, 99, 108], [108, 109, 107, 108]]);
    expect(evaluateTrade(buy(), b, 2).status).toBe("closed");
    expect(evaluateTrade(buy(), b, 1).status).toBe("open"); // rewound before the target candle
    expect(evaluateTrade(buy(), b, 3).exitIndex).toBe(2);
  });
});

describe("partial booking", () => {
  it("keeps what is left open and books the part that was closed", () => {
    const t = buy({ manualExits: [{ index: 3, price: 105, qty: 3 }] });
    expect(evaluateTrade(t, FLAT, 2)).toMatchObject({ status: "open", openQty: 10, exits: [] });
    const s = evaluateTrade(t, FLAT, 3);
    expect(s).toMatchObject({ status: "open", openQty: 7 });
    expect(s.exits).toEqual([{ index: 3, price: 105, qty: 3, reason: "manual" }]);
    expect(s.booked).toEqual({ points: 5, pct: 5, money: 15 });
  });

  it("closes the trade once everything is booked, and averages the exits", () => {
    const t = buy({ manualExits: [{ index: 2, price: 102, qty: 4 }, { index: 3, price: 105, qty: 6 }] });
    const s = evaluateTrade(t, FLAT, 3);
    expect(s).toMatchObject({ status: "closed", openQty: 0, exitIndex: 3, exitPrice: 105, exitReason: "manual" });
    expect(s.booked.money).toBe(8 + 30); // 4 x 2 + 6 x 5
    expect(s.booked.points).toBeCloseTo(3.8); // 38 over 10 units
  });

  it("closes what is left at the stop-loss or target after a partial exit", () => {
    const b = bars([...START, [100, 103, 99, 102], [100, 111, 99, 108]]);
    const t = buy({ manualExits: [{ index: 2, price: 102, qty: 3 }] });
    const s = evaluateTrade(t, b, 3);
    expect(s).toMatchObject({ status: "closed", exitReason: "target", exitPrice: 110 });
    expect(s.exits.map((e) => [e.qty, e.price, e.reason])).toEqual([[3, 102, "manual"], [7, 110, "target"]]);
    expect(s.booked.money).toBe(3 * 2 + 7 * 10);
  });

  it("applies a partial exit only once its candle is revealed (rewind-safe)", () => {
    const t = buy({ manualExits: [{ index: 3, price: 105, qty: 3 }] });
    expect(evaluateTrade(t, FLAT, 3).openQty).toBe(7);
    expect(evaluateTrade(t, FLAT, 2).openQty).toBe(10);
  });

  it("lets a stop-loss that hit before a manual exit win", () => {
    const b = bars([...START, [100, 101, 94, 96], [96, 97, 95, 96]]);
    const t = buy({ manualExits: [{ index: 3, price: 96, qty: 4 }] });
    expect(evaluateTrade(t, b, 3)).toMatchObject({ exitIndex: 2, exitReason: "stoploss", openQty: 0 });
  });
});

describe("placeOrder netting", () => {
  const book = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 106, 99, 105], [105, 108, 104, 107]]);
  const order = (over = {}) => ({ instrument: "CE" as const, side: "buy" as const, qty: 10, stopLoss: null, target: null, ...over });

  it("opens a trade when nothing is open on the instrument", () => {
    const r = placeOrder([], order(), book, 1, 1);
    expect(r).toMatchObject({ closedQty: 0, openedQty: 10 });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: "buy", qty: 10, entryIndex: 1, entryPrice: 100 });
  });

  it("selling 3 of a 10-lot buy leaves 7 open and books the 3", () => {
    const first = placeOrder([], order(), book, 1, 1).trades;
    const r = placeOrder(first, order({ side: "sell", qty: 3 }), book, 2, 2);
    expect(r).toMatchObject({ closedQty: 3, openedQty: 0 });
    expect(r.trades).toHaveLength(1); // no new trade: it reduced the one that was open
    const s = evaluateTrade(r.trades[0], book, 2);
    expect(s).toMatchObject({ openQty: 7, status: "open" });
    expect(s.booked.money).toBe(3 * 5); // sold 3 at 105 against a 100 entry
    expect(positionOf(r.trades, book, 2, "CE")).toMatchObject({ side: "buy", qty: 7, avgPrice: 100 });
  });

  it("closes the oldest trade first", () => {
    let trades = placeOrder([], order({ qty: 5 }), book, 1, 1).trades;
    trades = placeOrder(trades, order({ qty: 5 }), book, 2, 2).trades; // a second buy at 105
    const r = placeOrder(trades, order({ side: "sell", qty: 6 }), book, 3, 3);
    expect(evaluateTrade(r.trades[0], book, 3).openQty).toBe(0);
    expect(evaluateTrade(r.trades[1], book, 3).openQty).toBe(4);
  });

  it("opens a new trade for what is left when the order is bigger than the position", () => {
    const first = placeOrder([], order({ qty: 4 }), book, 1, 1).trades;
    const r = placeOrder(first, order({ side: "sell", qty: 10, stopLoss: 110, target: 90 }), book, 2, 2);
    expect(r).toMatchObject({ closedQty: 4, openedQty: 6 });
    expect(r.trades[1]).toMatchObject({ side: "sell", qty: 6, stopLoss: 110, target: 90 });
    expect(positionOf(r.trades, book, 2, "CE")).toMatchObject({ side: "sell", qty: 6, avgPrice: 105 });
  });

  it("keeps CE and PE apart", () => {
    const ce = placeOrder([], order({ qty: 10 }), book, 1, 1).trades;
    const r = placeOrder(ce, order({ instrument: "PE", side: "sell", qty: 3 }), book, 2, 2);
    expect(r).toMatchObject({ closedQty: 0, openedQty: 3 }); // a PE sell does not touch the CE buy
    expect(positionOf(r.trades, book, 2, "CE")?.qty).toBe(10);
    expect(positionOf(r.trades, book, 2, "PE")).toMatchObject({ side: "sell", qty: 3 });
  });

  it("treats a PE the same way: selling part of a bought PE leaves the rest", () => {
    const pe = placeOrder([], order({ instrument: "PE", qty: 10 }), book, 1, 1).trades;
    const r = placeOrder(pe, order({ instrument: "PE", side: "sell", qty: 4 }), book, 2, 2);
    expect(positionOf(r.trades, book, 2, "PE")).toMatchObject({ side: "buy", qty: 6 });
    // a Buy PE gains when the chart falls, so selling 4 at 105 against a 100 entry books a loss
    expect(evaluateTrade(r.trades[0], book, 2).booked.money).toBe(-5 * 4);
  });

  it("rewinds cleanly: the booking disappears when the position goes back before it", () => {
    const first = placeOrder([], order(), book, 1, 1).trades;
    const r = placeOrder(first, order({ side: "sell", qty: 3 }), book, 2, 2).trades;
    expect(positionOf(r, book, 2, "CE")?.qty).toBe(7);
    expect(positionOf(r, book, 1, "CE")?.qty).toBe(10);
  });

  it("closeTradeAtMarket closes whatever is still open on that trade", () => {
    const first = placeOrder([], order(), book, 1, 1).trades;
    const part = placeOrder(first, order({ side: "sell", qty: 3 }), book, 2, 2).trades;
    const closed = closeTradeAtMarket(part, 1, book, 3);
    expect(evaluateTrade(closed[0], book, 3)).toMatchObject({ status: "closed", openQty: 0 });
    expect(evaluateTrade(closed[0], book, 3).booked.money).toBe(3 * 5 + 7 * 7);
  });
});

describe("CE and PE", () => {
  it("gains with the market for Buy CE and Sell PE, and against it for Sell CE and Buy PE", () => {
    expect(marketDirection("CE", "buy")).toBe(1);
    expect(marketDirection("PE", "sell")).toBe(1);
    expect(marketDirection("CE", "sell")).toBe(-1);
    expect(marketDirection("PE", "buy")).toBe(-1);
  });

  it("makes a Buy PE profit when the market falls", () => {
    const pe = buy({ id: 3, instrument: "PE", stopLoss: 105, target: 90 });
    expect(amountAt(pe, 95)).toEqual({ points: 5, pct: 5, money: 50 });
    expect(amountAt(pe, 104)).toEqual({ points: -4, pct: -4, money: -40 });
    const down = bars([...START, [100, 101, 89, 92]]);
    expect(evaluateTrade(pe, down, 2)).toMatchObject({ exitReason: "target", exitPrice: 90 });
    const up = bars([...START, [100, 106, 99, 104]]);
    expect(evaluateTrade(pe, up, 2)).toMatchObject({ exitReason: "stoploss", exitPrice: 105 });
  });

  it("makes a Sell PE profit when the market rises", () => {
    const pe = buy({ id: 4, instrument: "PE", side: "sell", stopLoss: 95, target: 110 });
    expect(amountAt(pe, 110)).toEqual({ points: 10, pct: 10, money: 100 });
  });
});

describe("amountAt", () => {
  it("gives points, percent and money for a buy and a sell, for part of the quantity too", () => {
    expect(amountAt(buy(), 110)).toEqual({ points: 10, pct: 10, money: 100 });
    expect(amountAt(buy(), 95)).toEqual({ points: -5, pct: -5, money: -50 });
    expect(amountAt(buy({ side: "sell" }), 95)).toEqual({ points: 5, pct: 5, money: 50 });
    expect(amountAt(buy(), 110, 3).money).toBe(30);
  });
});

describe("levelFromDistance and validateOrder", () => {
  it("places the stop-loss against the trade and the target with it", () => {
    expect(levelFromDistance(1, 100, "stoploss", 5, "pts")).toBe(95);
    expect(levelFromDistance(1, 100, "target", 2, "%")).toBe(102);
    expect(levelFromDistance(-1, 100, "stoploss", 2, "%")).toBe(102);
    expect(levelFromDistance(-1, 100, "target", 10, "pts")).toBe(90);
  });

  it("rejects levels on the wrong side and bad sizes", () => {
    expect(validateOrder(1, 100, 1, 95, 110)).toBeNull();
    expect(validateOrder(1, 100, 1, 105, null)).toMatch(/below the entry/);
    expect(validateOrder(1, 100, 1, null, 90)).toMatch(/above the entry/);
    expect(validateOrder(-1, 100, 1, 95, null)).toMatch(/above the entry/);
    expect(validateOrder(-1, 100, 1.5, null, null)).toMatch(/whole number/);
    expect(validateOrder(1, NaN, 1, null, null)).toMatch(/No price/);
  });
});

describe("summarize", () => {
  it("adds up booked and floating results and the win rate", () => {
    const b = bars([
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 111, 99, 108],   // trade 1 hits its target here: +100
      [108, 109, 107, 108],
    ]);
    const trades = [buy({ id: 1 }), buy({ id: 2, entryIndex: 2, entryPrice: 108, stopLoss: null, target: null })];
    const s = summarize(trades, b, 3);
    expect(s).toMatchObject({ total: 2, open: 1, closed: 1, wins: 1, winRate: 100 });
    expect(s.booked.money).toBe(100);
    expect(s.floating.money).toBe(0);
  });

  it("counts what was booked out of a trade that is still open, and marks only the rest", () => {
    const t = buy({ stopLoss: null, target: null, manualExits: [{ index: 3, price: 105, qty: 3 }] });
    const s = summarize([t], FLAT, 3);
    expect(s).toMatchObject({ total: 1, open: 1, closed: 0 });
    expect(s.booked.money).toBe(15);
    expect(s.floating.money).toBe(7 * 5); // 7 left, marked at 105
  });

  it("ignores trades placed after the current position", () => {
    expect(summarize([buy({ entryIndex: 3 })], FLAT, 1).total).toBe(0);
  });
});

describe("moving the stop-loss and target", () => {
  const run = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],   // entry at 100 (index 1)
    [100, 103, 98, 102],   // candle 2: low 98
    [102, 104, 101, 103],  // candle 3: low 101
    [103, 105, 100, 101],  // candle 4: low 100
  ]);

  it("applies a change from the candle after the one it was made on", () => {
    // stop-loss raised to 99 on candle 2: candle 2's own low of 98 does not trigger it, candle 3 (low 101) does not either
    const t = buy({ stopLoss: 90, adjustments: [{ index: 2, stopLoss: 99 }] });
    expect(evaluateTrade(t, run, 3)).toMatchObject({ status: "open", stopLoss: 99 });
    // candle 4 has a low of 100, still above 99; raise it to 102 on candle 3 and candle 4 stops it out
    const trailed = buy({ stopLoss: 90, adjustments: [{ index: 2, stopLoss: 99 }, { index: 3, stopLoss: 102 }] });
    expect(evaluateTrade(trailed, run, 4)).toMatchObject({ status: "closed", exitIndex: 4, exitPrice: 102, exitReason: "stoploss" });
  });

  it("shows the level in force at each replay position", () => {
    const t = buy({ adjustments: [{ index: 3, stopLoss: 101, target: null }] });
    expect(evaluateTrade(t, run, 2)).toMatchObject({ stopLoss: 95, target: 110 });
    expect(evaluateTrade(t, run, 3)).toMatchObject({ stopLoss: 101, target: null });
  });

  it("adjustLevels moves the open trades of one instrument and merges changes on the same candle", () => {
    const trades = [buy({ id: 1 }), buy({ id: 2, instrument: "PE" })];
    let next = adjustLevels(trades, "CE", { stopLoss: 97 }, run, 2);
    next = adjustLevels(next, "CE", { stopLoss: 98, target: 112 }, run, 2); // same candle: replaces the first change
    expect(next[0].adjustments).toEqual([{ index: 2, stopLoss: 98, target: 112 }]);
    expect(next[1].adjustments).toEqual([]); // the PE trade is untouched
    expect(evaluateTrade(next[0], run, 2)).toMatchObject({ stopLoss: 98, target: 112 });
  });

  it("removes a level with null, and leaves closed trades alone", () => {
    const done = buy({ id: 3, manualExits: [{ index: 2, price: 102, qty: 10 }] });
    const [open, closed] = adjustLevels([buy(), done], "CE", { stopLoss: null }, run, 3);
    expect(evaluateTrade(open, run, 3).stopLoss).toBeNull();
    expect(closed.adjustments).toEqual([]);
  });

  it("makes a new buy on the instrument adopt the position's current stop-loss and target", () => {
    const first = placeOrder([], { instrument: "CE", side: "buy", qty: 5, stopLoss: 95, target: 110 }, run, 1, 1).trades;
    const moved = adjustLevels(first, "CE", { stopLoss: 99 }, run, 2);
    const r = placeOrder(moved, { instrument: "CE", side: "buy", qty: 5, stopLoss: 90, target: 130 }, run, 3, 2);
    expect(r.trades[1]).toMatchObject({ stopLoss: 99, target: 110 }); // the order's own 90 / 130 are ignored
    expect(positionOf(r.trades, run, 3, "CE")).toMatchObject({ qty: 10, stopLoss: 99, target: 110 });
  });

  it("uses the order's own levels when the instrument is flat", () => {
    const r = placeOrder([], { instrument: "PE", side: "buy", qty: 2, stopLoss: 105, target: 90 }, run, 1, 1);
    expect(r.trades[0]).toMatchObject({ stopLoss: 105, target: 90 });
  });
});

describe("position levels, closePosition and closeAll", () => {
  const run = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [100, 104, 99, 104],
  ]);

  it("reports the position's levels, direction and floating result", () => {
    const trades = placeOrder([], { instrument: "PE", side: "buy", qty: 10, stopLoss: 105, target: 90 }, run, 1, 1).trades;
    expect(positionOf(trades, run, 2, "PE")).toEqual({
      instrument: "PE", side: "buy", direction: -1, qty: 10, avgPrice: 100, stopLoss: 105, target: 90,
      floating: -40, // a Buy PE loses 4 per unit when the chart rises to 104
    });
  });

  it("closePosition books part of a position at market and never opens an opposite trade", () => {
    const trades = placeOrder([], { instrument: "CE", side: "buy", qty: 10, stopLoss: null, target: null }, run, 1, 1).trades;
    const part = closePosition(trades, "CE", 4, run, 2);
    expect(positionOf(part, run, 2, "CE")).toMatchObject({ qty: 6 });
    const over = closePosition(trades, "CE", 99, run, 2);
    expect(positionOf(over, run, 2, "CE")).toBeNull();
    expect(over).toHaveLength(1); // nothing new was opened
    expect(closePosition(trades, "PE", 3, run, 2)).toBe(trades); // nothing open on PE
  });

  it("closeAll closes both instruments", () => {
    let trades = placeOrder([], { instrument: "CE", side: "buy", qty: 3, stopLoss: null, target: null }, run, 1, 1).trades;
    trades = placeOrder(trades, { instrument: "PE", side: "buy", qty: 2, stopLoss: null, target: null }, run, 1, 2).trades;
    const flat = closeAll(trades, run, 2);
    expect(positionOf(flat, run, 2, "CE")).toBeNull();
    expect(positionOf(flat, run, 2, "PE")).toBeNull();
  });
});
