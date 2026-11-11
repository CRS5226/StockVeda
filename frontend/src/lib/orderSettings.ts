// What the CE / PE cards and the "+" menu on the chart share: the card values (size, stop-loss, target), how an open
// position's levels show in those fields, and how an order is built from them.

import {
  levelFromDistance, marketDirection, validateOrder,
  type Instrument, type LevelUnit, type Order, type Position, type Side,
} from "./paperTrading";

/** Values of one card. Text, so a half-typed number is fine. */
export interface CardSettings { qty: string; slValue: string; slUnit: LevelUnit; tpValue: string; tpUnit: LevelUnit }

// A card opens with a 1% stop-loss and a 2% target; clear a field to place the order without it.
export const DEFAULT_SETTINGS: CardSettings = { qty: "1", slValue: "1", slUnit: "%", tpValue: "2", tpUnit: "%" };

type Kind = "stoploss" | "target";

/**
 * What a stop-loss / target field shows for an open position: how far the level is from the average entry, in
 * `unit`, counted in the direction the trade loses (stop-loss) or gains (target). A stop-loss moved past the entry
 * to lock in profit shows as a negative number. "" when the position has no such level.
 */
export function levelToField(position: Position, kind: Kind, unit: LevelUnit): string {
  const level = kind === "stoploss" ? position.stopLoss : position.target;
  if (level === null) return "";
  const away = kind === "target" ? (level - position.avgPrice) * position.direction : (position.avgPrice - level) * position.direction;
  const value = unit === "%" ? (away / position.avgPrice) * 100 : away;
  return String(Number(value.toFixed(2)));
}

/** The level price for text typed into a field of an open position: null removes the level, undefined is not a number. */
export function fieldToLevel(position: Position, kind: Kind, text: string, unit: LevelUnit): number | null | undefined {
  if (text.trim() === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  const away = unit === "%" ? (position.avgPrice * value) / 100 : value;
  return position.avgPrice + (kind === "target" ? position.direction : -position.direction) * away;
}

/** Why a level cannot be set, or null. A stop-loss has to sit on the losing side of the current price, a target on the winning side. */
export function validateLevel(direction: 1 | -1, price: number, kind: Kind, level: number): string | null {
  if (!Number.isFinite(level) || level <= 0) return "That is not a valid price.";
  const long = direction === 1; // gains as the chart price rises
  if (kind === "stoploss" && (long ? level >= price : level <= price)) {
    return long ? "The stop-loss must be below the current price." : "The stop-loss must be above the current price.";
  }
  if (kind === "target" && (long ? level <= price : level >= price)) {
    return long ? "The target must be above the current price." : "The target must be below the current price.";
  }
  return null;
}

/** A dragged level pulled back to the nearest valid price (a hair beyond the current price). */
export function clampLevel(direction: 1 | -1, price: number, kind: Kind, level: number): number {
  const margin = price * 0.0001;
  const losing = kind === "stoploss" ? direction : -direction; // +1: the level belongs below the price
  return losing === 1 ? Math.min(level, price - margin) : Math.max(level, price + margin);
}

/**
 * The order for a Buy / Sell press: size from the card (or `qty`), levels from the card's stop-loss and target.
 * Part of the order that closes an opposite holding needs no levels, and a buy that adds to a holding takes the
 * position's own levels, so only an order that opens a fresh position is checked against the card's levels.
 */
export function buildOrder(
  instrument: Instrument, side: Side, settings: CardSettings, price: number, holding: Position | null,
  qty: number = Number(settings.qty),
): { order: Order } | { error: string } {
  const direction = marketDirection(instrument, side);
  const closes = holding && holding.side !== side && Number.isInteger(qty) && qty > 0 ? Math.min(qty, holding.qty) : 0;
  const opensNew = qty - closes > 0;
  const adds = !!holding && holding.side === side;

  const parse = (text: string) => (text.trim() === "" ? null : Number(text));
  const sl = parse(settings.slValue), tp = parse(settings.tpValue);
  const bad = (n: number | null) => n !== null && (!Number.isFinite(n) || n <= 0);
  if (opensNew && !adds && (bad(sl) || bad(tp))) return { error: "Stop-loss and target distances must be numbers above 0." };

  const useLevels = opensNew && !adds;
  const stopLoss = useLevels && sl !== null ? levelFromDistance(direction, price, "stoploss", sl, settings.slUnit) : null;
  const target = useLevels && tp !== null ? levelFromDistance(direction, price, "target", tp, settings.tpUnit) : null;
  const problem = validateOrder(direction, price, qty, stopLoss, target);
  return problem ? { error: problem } : { order: { instrument, side, qty, stopLoss, target } };
}
