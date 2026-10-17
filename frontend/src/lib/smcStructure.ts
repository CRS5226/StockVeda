// SMC (Smart Money Concepts) market-structure mapping — client-side, chart-overlay only.
// Covers IDM (inducement), BOS (Break of Structure), ChoCH (Change of Character) and the
// HH/HL/LH/LL points they confirm, following lectures/YTlecture "BOS_ChiCH and inducement".
// See GitHub issue #79 for the full SMC/ICT concept list this will grow into.

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface SwingPoint {
  date: string;
  index: number;
  price: number;
  type: "high" | "low";
}

/**
 * Simple fractal swing detection: a swing high/low is a bar whose high/low is the
 * most extreme within `lookback` bars on either side. A swing is only "confirmed"
 * once `lookback` bars have closed after it — that lag is inherent to fractals.
 * Used for liquidity pools; the structure map below uses the lecture's own swing rules.
 */
export function detectSwingPoints(ohlcv: OhlcvRow[], lookback = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    const window = ohlcv.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((r) => r.high <= ohlcv[i].high);
    const isLow  = window.every((r) => r.low  >= ohlcv[i].low);
    if (isHigh) swings.push({ date: ohlcv[i].date.slice(0, 10), index: i, price: ohlcv[i].high, type: "high" });
    if (isLow)  swings.push({ date: ohlcv[i].date.slice(0, 10), index: i, price: ohlcv[i].low,  type: "low" });
  }
  return swings;
}

/** An event drawn as a level from `fromDate` to `date` (BOS / ChoCH / IDM). */
export interface StructureEvent {
  date: string;                // bar where the event happens (the break / the bar that took the IDM)
  type: "BOS" | "ChoCH" | "IDM";
  direction: "bullish" | "bearish"; // bullish = trend up (BOS up / ChoCH to up), bearish = trend down
  level: number;               // the swing price that was broken / taken
  fromDate: string;            // the swing point's date (line start)
}

/** A structure point, only emitted once it is confirmed (HH/LL by IDM, HL/LH by BOS). */
export interface StructurePoint {
  type: "HH" | "HL" | "LH" | "LL";
  date: string;                // the candle that formed the point
  price: number;
  confirmedDate: string;
}

export interface StructureMap { events: StructureEvent[]; points: StructurePoint[] }

/** A candle after inside-bar merging: bars nested inside an inside bar fold into it. */
interface Candle { date: string; high: number; low: number; close: number; inside: boolean }

/**
 * Lecture rule: an inside bar stays a candle of its own (a later candle can take its
 * low/high), but bars inside *that* inside bar are just noise and fold into it — taking
 * the liquidity of such a nested bar does not count.
 */
function buildCandles(ohlcv: OhlcvRow[]): Candle[] {
  const out: Candle[] = [];
  ohlcv.forEach((r) => {
    const prev = out[out.length - 1];
    const inside = !!prev && r.high <= prev.high && r.low >= prev.low;
    if (inside && prev.inside) { prev.close = r.close; return; }
    out.push({ date: r.date.slice(0, 10), high: r.high, low: r.low, close: r.close, inside });
  });
  return out;
}

interface Swing { k: number; price: number }

/**
 * Valid swings per the lecture. A swing LOW exists when a candle takes the liquidity (low)
 * of the previous candle and a later candle then CLOSES (body, not wick) above the high of
 * the dip. A wick above the dip high only moves that high up — the next candle must close
 * beyond the wick. The mirrored rule gives swing HIGHS. Unconfirmed dips are not swings.
 */
function findSwings(c: Candle[], from: number, to: number, kind: "low" | "high"): Swing[] {
  const low = kind === "low";
  const taker = (k: number) => (low ? c[k].low < c[k - 1].low : c[k].high > c[k - 1].high);
  const dip = (k: number) => (low ? c[k].low : c[k].high);
  const farther = (a: number, b: number) => (low ? a < b : a > b); // a is a deeper dip than b
  const swings: Swing[] = [];
  let k = Math.max(from, 0) + 1;
  while (k <= to) {
    if (!taker(k)) { k++; continue; }
    let ext = k;
    let bound = low ? Math.max(c[k - 1].high, c[k].high) : Math.min(c[k - 1].low, c[k].low);
    let confirmed = false;
    let m = k + 1;
    for (; m <= to; m++) {
      if (farther(dip(m), dip(ext))) {
        // a deeper dip supersedes the earlier one: the level to beat is now that bar's own
        // (and its predecessor's) high, otherwise a long decline would count as a single dip
        ext = m;
        bound = low ? Math.max(c[m - 1].high, c[m].high) : Math.min(c[m - 1].low, c[m].low);
        continue;
      }
      if (low ? c[m].close > bound : c[m].close < bound) { confirmed = true; break; }
      if (low ? c[m].high > bound : c[m].low < bound) bound = low ? c[m].high : c[m].low; // wick: shift the level
    }
    if (!confirmed) break; // ran off the end without a body close — nothing later can confirm either
    swings.push({ k: ext, price: dip(ext) });
    k = m;
  }
  return swings;
}

/**
 * Walks the candles once with the lecture's state machine. In an up-trend:
 *  - the running high is only a CANDIDATE HH; it is confirmed once price takes the IDM
 *    (the nearest valid swing low to the left of that high — a wick/tap is enough);
 *  - a body close above the confirmed HH is a BOS, which also confirms the HL (lowest point
 *    of that pullback) and moves the ChoCH point there;
 *  - a body close below the ChoCH point is a ChoCH: the trend flips and the old leg's high
 *    becomes the new ChoCH point.
 * Down-trends mirror this. No IDM yet means no HH/LL is marked. Mapping starts from the
 * range's major extreme (the low if price now sits in the upper half, else the high).
 */
export function mapStructure(ohlcv: OhlcvRow[]): StructureMap {
  const events: StructureEvent[] = [];
  const points: StructurePoint[] = [];
  const c = buildCandles(ohlcv);
  const n = c.length;
  if (n < 5) return { events, points };

  let lo = 0, hi = 0;
  c.forEach((x, k) => { if (x.low < c[lo].low) lo = k; if (x.high > c[hi].high) hi = k; });
  const startAtLow = c[n - 1].close >= (c[lo].low + c[hi].high) / 2;
  const anchor = startAtLow ? lo : hi;
  if (anchor >= n - 2) return { events, points };

  // dir +1 = up-trend, -1 = down-trend. "ext" = high when up, low when down; "cnt" is the
  // opposite side (the pullbacks that form the IDM and the protected point).
  const ext = (k: number, d: number) => (d > 0 ? c[k].high : c[k].low);
  const cnt = (k: number, d: number) => (d > 0 ? c[k].low : c[k].high);
  const beats = (a: number, b: number, d: number) => (d > 0 ? a > b : a < b);
  const closedBeyond = (k: number, level: number, d: number) => (d > 0 ? c[k].close > level : c[k].close < level);
  const ptType = (d: number, extreme: boolean): StructurePoint["type"] =>
    extreme ? (d > 0 ? "HH" : "LL") : (d > 0 ? "HL" : "LH");
  /** Index of the most extreme `cnt` value (lowest low when d>0, highest high when d<0) in [a, b]. */
  const counterExtreme = (a: number, b: number, d: number) => {
    let p = a;
    for (let j = a; j <= b; j++) if (beats(cnt(p, d), cnt(j, d), d)) p = j;
    return p;
  };

  let dir = startAtLow ? -1 : 1; // anchoring at the low means the leg that just ended was a down-trend
  let cand: Swing = { k: anchor, price: ext(anchor, dir) };
  let legStart = 0;
  let idm: Swing | null = null;
  let hh: Swing | null = null;

  const nearestIdm = (): Swing | null => {
    const sw = findSwings(c, legStart, cand.k, dir > 0 ? "low" : "high").filter((s) => s.k < cand.k);
    return sw.length ? sw[sw.length - 1] : null;
  };

  // Seed the protected point: the valid counter-swing just beyond the IDM, else the leg's far end.
  idm = nearestIdm();
  const seedEnd = idm ? idm.k : anchor;
  const farSwings = idm
    ? findSwings(c, 0, idm.k, dir > 0 ? "low" : "high").filter((s) => s.k < idm!.k && beats(cnt(s.k, dir), idm!.price, -dir))
    : [];
  const seed = farSwings.length ? farSwings[farSwings.length - 1].k : counterExtreme(0, seedEnd, dir);
  let choch: Swing = { k: seed, price: farSwings.length ? farSwings[farSwings.length - 1].price : cnt(seed, dir) };

  const dirName = (): StructureEvent["direction"] => (dir > 0 ? "bullish" : "bearish");

  // Extends the candidate extreme, or confirms it once the IDM is taken. Used for live bars
  // and for replaying the bars of a freshly started leg.
  const step = (k: number) => {
    if (beats(ext(k, dir), cand.price, dir)) {
      cand = { k, price: ext(k, dir) };
      idm = nearestIdm();
    } else if (idm && beats(idm.price, cnt(k, dir), dir)) {
      // price took the IDM (a wick/tap is enough) → the candidate HH/LL is confirmed
      hh = cand;
      events.push({ date: c[k].date, type: "IDM", direction: dirName(), level: idm.price, fromDate: c[idm.k].date });
      points.push({ type: ptType(dir, true), date: c[cand.k].date, price: cand.price, confirmedDate: c[k].date });
    }
  };

  for (let k = anchor + 1; k < n; k++) {
    // ChoCH: body close beyond the protected point, against the trend.
    if (closedBeyond(k, choch.price, -dir)) {
      events.push({
        date: c[k].date, type: "ChoCH", direction: dir > 0 ? "bearish" : "bullish",
        level: choch.price, fromDate: c[choch.k].date,
      });
      const old: Swing = hh ?? cand;
      dir = -dir;
      choch = { k: old.k, price: old.price }; // the old leg's extreme is now the protected point
      let e = old.k;
      for (let j = old.k; j <= k; j++) if (beats(ext(j, dir), ext(e, dir), dir)) e = j;
      cand = { k: e, price: ext(e, dir) };
      legStart = old.k;
      hh = null;
      idm = nearestIdm();
      for (let j = cand.k + 1; j <= k && !hh; j++) step(j);
      continue;
    }

    if (hh) {
      if (closedBeyond(k, hh.price, dir)) {
        // BOS: continuation. The deepest point of the pullback becomes the new protected point.
        events.push({ date: c[k].date, type: "BOS", direction: dirName(), level: hh.price, fromDate: c[hh.k].date });
        const p = counterExtreme(hh.k, k, dir);
        points.push({ type: ptType(dir, false), date: c[p].date, price: cnt(p, dir), confirmedDate: c[k].date });
        choch = { k: p, price: cnt(p, dir) };
        cand = { k, price: ext(k, dir) };
        legStart = p; // the new IDM must form inside the new leg, after the HL — not the pullback that made it
        hh = null;
        idm = nearestIdm();
      } else if (beats(ext(k, dir), hh.price, dir)) {
        hh = { k, price: ext(k, dir) }; // wick through, no body close: the level moves to the wick
      }
    } else {
      step(k);
    }
  }
  return { events, points };
}
