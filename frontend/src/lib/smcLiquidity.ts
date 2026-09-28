// SMC (Smart Money Concepts) liquidity + inducement detection — client-side, chart-overlay
// only. See GitHub issue #79 for the full concept list this will grow into.

import { detectSwingPoints, detectStructureEvents, type SwingPoint } from "./smcStructure";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface LiquidityPool {
  type: "EQH" | "EQL"; // equal highs (resting buy-side liquidity above) / equal lows (sell-side, below)
  level: number;
  startDate: string;
  endDate: string;
  swings: SwingPoint[];
}

export interface LiquiditySweep {
  date: string;
  index: number;
  pool: LiquidityPool;
  direction: "buy-side" | "sell-side"; // which side's resting liquidity got grabbed
}

export interface InducementPoint {
  date: string;
  index: number;
  price: number;
  direction: "bullish" | "bearish"; // the leg this minor swing was used to induce traders against
}

const nearlyEqual = (a: number, b: number, tolPct: number) => Math.abs(a - b) / ((a + b) / 2) <= tolPct;

/**
 * Groups swing highs/lows that sit within `tolPct` of each other into "equal
 * highs/lows" liquidity pools — the classic SMC read of a resting stop cluster.
 */
export function detectLiquidityPools(ohlcv: OhlcvRow[], lookback = 2, tolPct = 0.0015): LiquidityPool[] {
  const swings = detectSwingPoints(ohlcv, lookback);
  const highs = swings.filter((s) => s.type === "high").sort((a, b) => a.index - b.index);
  const lows  = swings.filter((s) => s.type === "low").sort((a, b) => a.index - b.index);

  const cluster = (points: SwingPoint[], type: "EQH" | "EQL"): LiquidityPool[] => {
    const pools: LiquidityPool[] = [];
    const used = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      const group = [points[i]];
      used.add(i);
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        if (nearlyEqual(points[j].price, points[i].price, tolPct)) { group.push(points[j]); used.add(j); }
      }
      if (group.length >= 2) {
        const level = group.reduce((sum, p) => sum + p.price, 0) / group.length;
        pools.push({ type, level, startDate: group[0].date, endDate: group[group.length - 1].date, swings: group });
      }
    }
    return pools;
  };

  return [...cluster(highs, "EQH"), ...cluster(lows, "EQL")];
}

/** First bar after a pool's last swing that wicks through the level but closes back — a liquidity grab. */
export function detectLiquiditySweeps(ohlcv: OhlcvRow[], pools: LiquidityPool[]): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  pools.forEach((pool) => {
    const startIdx = pool.swings[pool.swings.length - 1].index + 1;
    for (let i = startIdx; i < ohlcv.length; i++) {
      const bar = ohlcv[i];
      if (pool.type === "EQH" && bar.high > pool.level && bar.close < pool.level) {
        sweeps.push({ date: bar.date.slice(0, 10), index: i, pool, direction: "buy-side" });
        break;
      }
      if (pool.type === "EQL" && bar.low < pool.level && bar.close > pool.level) {
        sweeps.push({ date: bar.date.slice(0, 10), index: i, pool, direction: "sell-side" });
        break;
      }
    }
  });
  return sweeps;
}

/**
 * v1 heuristic: for each BOS/ChoCH leg (from the structure detector), find the most
 * recent opposite-type minor swing formed during that leg which itself got broken
 * before the final breakout bar — i.e. a minor pullback point used to trigger stops
 * on the way to the real structure break. Legs with no such broken minor swing have
 * no inducement marked. Worth revisiting once liquidity-pool context (above) is used
 * to require the induced level itself be a resting-liquidity point, not just any swing.
 */
export function detectInducementPoints(ohlcv: OhlcvRow[], lookback = 2): InducementPoint[] {
  const swings = detectSwingPoints(ohlcv, lookback);
  const events = detectStructureEvents(ohlcv, lookback);
  const points: InducementPoint[] = [];

  events.forEach((ev) => {
    const oppositeType = ev.direction === "bullish" ? "low" : "high";
    const minorSwings = swings.filter(
      (s) => s.type === oppositeType && s.index > ev.fromIndex && s.index < ev.index
    );
    if (!minorSwings.length) return;

    for (let k = minorSwings.length - 1; k >= 0; k--) {
      const minor = minorSwings[k];
      const broken = ohlcv.some(
        (bar, idx) =>
          idx > minor.index && idx < ev.index &&
          (ev.direction === "bullish" ? bar.close < minor.price : bar.close > minor.price)
      );
      if (broken) {
        points.push({ date: minor.date, index: minor.index, price: minor.price, direction: ev.direction });
        break;
      }
    }
  });

  return points;
}
