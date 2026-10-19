import { describe, expect, it } from "vitest";
import { detectInverseFvgs, detectLegFvgs } from "./smcFvg";
import { buildCandles, type StructureLeg } from "./smcStructure";

// A bar is [open, high, low, close]. Fixtures follow lectures/YTlecture "order block / FVG / order flow"
// and the Alchemy FVG guide.
type Bar = [number, number, number, number];

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const candles = (rows: Bar[]) =>
  buildCandles(rows.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close })));
const mirror = (rows: Bar[]): Bar[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);

const leg = (over: Partial<StructureLeg> = {}): StructureLeg => ({
  direction: "bullish", idm: { k: 0, price: 0 }, extreme: { k: 0, price: 113 },
  protected: { k: 3, price: 100 }, from: 1, to: 3, open: false, ...over,
});
const mirrorLeg = (l: StructureLeg): StructureLeg => ({
  ...l, direction: "bearish",
  idm: { ...l.idm, price: 200 - l.idm.price }, extreme: { ...l.extreme, price: 200 - l.extreme.price },
  protected: { ...l.protected, price: 200 - l.protected.price },
});

// Pullback to a low of 100, then an up-move with two gaps: 104.5 -> 105 above candle 3, 106 -> 108 above candle 4.
const PULLBACK: Bar[] = [
  [110, 112, 108, 111],
  [111, 111, 105, 106],      // took the IDM
  [106, 107, 103, 104],
  [104, 104.5, 100, 101],    // the HL
  [101, 106, 100.5, 105],
  [105, 109, 105, 108.8],
  [108.8, 115, 108, 114],    // back at the HH
];

describe("FVG rules", () => {
  it("is the space between the first candle's high and the third candle's low", () => {
    const fvgs = detectLegFvgs(candles(PULLBACK), leg());
    expect(fvgs.map((f) => [f.k, f.bottom, f.top, f.direction])).toEqual([
      [3, 104.5, 105, "bullish"],
      [4, 106, 108, "bullish"],
    ]);
  });

  it("no gap when the third candle's low only meets the first candle's high", () => {
    const rows = PULLBACK.map((r) => [...r] as Bar);
    rows[5] = [105, 109, 104.5, 108.8];
    expect(detectLegFvgs(candles(rows), leg()).map((f) => f.k)).toEqual([4]);
  });

  it("colour and size of the gap do not matter", () => {
    const rows = PULLBACK.map((r) => [...r] as Bar);
    rows[5] = [108.8, 109, 104.6, 105]; // a down-closing third candle, a one-tick gap
    expect(detectLegFvgs(candles(rows), leg()).map((f) => f.k)).toContain(3);
  });

  it("looks only along the leg: gaps in the impulse before the IDM are skipped", () => {
    const early: Bar[] = [[90, 91, 89, 90.5], [90.5, 99, 90.4, 98.5], [98.5, 112, 98, 111]]; // gap 91 -> 98 before the leg
    const rows = [...early, ...PULLBACK];
    const l = leg({ from: 4, to: 6, protected: { k: 6, price: 100 } });
    expect(detectLegFvgs(candles(rows), l).map((f) => f.k)).toEqual([6, 7]);
  });

  it("a gap against the leg's direction is not an FVG here", () => {
    const rows: Bar[] = [[110, 111, 108, 109], [109, 109.5, 104, 104.5], [104.5, 105, 100, 101], [101, 106, 100.5, 105]];
    // candles 0 and 2 leave a bearish gap (108 > 105) inside a bullish leg
    expect(detectLegFvgs(candles(rows), leg({ from: 0, to: 2, extreme: { k: 0, price: 1000 } }))).toEqual([]);
  });

  it("marks the gap that makes an order block valid as attached", () => {
    const fvgs = detectLegFvgs(candles(PULLBACK), leg());
    expect(fvgs.map((f) => f.attached)).toEqual([true, false]);
  });

  it("mirrors into bearish gaps", () => {
    const up = detectLegFvgs(candles(PULLBACK), leg());
    const down = detectLegFvgs(candles(mirror(PULLBACK)), mirrorLeg(leg()));
    expect(down.map((f) => [f.k, f.direction, f.attached, f.type])).toEqual(up.map((f) => [f.k, "bearish", f.attached, f.type]));
    expect(down.map((f) => [200 - f.top, 200 - f.bottom])).toEqual(up.map((f) => [f.bottom, f.top]));
  });
});

describe("FVG types", () => {
  const FIRST: Bar = [100, 101, 99, 100];
  const MID: Bar = [101, 109, 100.5, 108]; // range 8.5
  const typeOf = (third: Bar, down = false) => {
    const rows: Bar[] = [FIRST, MID, third];
    const up = leg({ from: 0, to: 0, extreme: { k: 0, price: 1000 } });
    const [f] = detectLegFvgs(candles(down ? mirror(rows) : rows), down ? mirrorLeg(up) : up);
    return f?.type;
  };

  it("RFG: the third candle closes back into the middle candle", () => {
    expect(typeOf([107, 108, 102, 105])).toBe("RFG");
  });
  it("PFG: a small third candle that never trades back past the middle candle's close", () => {
    expect(typeOf([108.5, 111, 108.2, 110.5])).toBe("PFG");
  });
  it("BFG: a large third candle that closes beyond the middle candle", () => {
    expect(typeOf([108.5, 118, 108.2, 117])).toBe("BFG");
  });
  it("a plain FVG is none of those", () => {
    expect(typeOf([108, 112, 107, 111.5])).toBe("FVG");
  });
  it("mirrors into the bearish types", () => {
    expect(typeOf([107, 108, 102, 105], true)).toBe("RFG");
    expect(typeOf([108.5, 111, 108.2, 110.5], true)).toBe("PFG");
    expect(typeOf([108.5, 118, 108.2, 117], true)).toBe("BFG");
    expect(typeOf([108, 112, 107, 111.5], true)).toBe("FVG");
  });
});

describe("FVG status and CE", () => {
  const first = (...tail: Bar[]) => detectLegFvgs(candles([...PULLBACK, ...tail]), leg())[0];

  it("CE is the midpoint", () => {
    expect(first().ce).toBe(104.75);
  });

  it("not revisited is unmitigated and runs to the last candle", () => {
    expect(first()).toMatchObject({ status: "unmitigated", ceBroken: false, endK: 6 });
  });

  it("tapping in without filling is partial", () => {
    expect(first([114, 114.5, 104.8, 105.5])).toMatchObject({ status: "partial", ceBroken: false, endK: 7 });
  });

  it("trading through the far edge fills it", () => {
    expect(first([114, 114.5, 104.8, 105.5], [105.5, 106, 104, 105])).toMatchObject({ status: "full", endK: 8 });
  });

  it("a close beyond the CE breaks it even when the gap is not filled", () => {
    expect(first([114, 114.5, 104.6, 104.7])).toMatchObject({ status: "partial", ceBroken: true });
  });

  it("mirrors into a bearish gap", () => {
    const tail: Bar[] = [[114, 114.5, 104.8, 105.5], [105.5, 106, 104, 105]];
    const up = first(...tail);
    const [down] = detectLegFvgs(candles(mirror([...PULLBACK, ...tail])), mirrorLeg(leg()));
    expect([down.status, down.ceBroken, down.endK, 200 - down.ce]).toEqual([up.status, up.ceBroken, up.endK, up.ce]);
  });
});

describe("inverse FVG", () => {
  const run = (rows: Bar[], l = leg()) => {
    const c = candles(rows);
    const fvgs = detectLegFvgs(c, l);
    return detectInverseFvgs(c, fvgs);
  };

  it("a gap that price closes through flips role from the bar that closed through it", () => {
    const [i] = run([...PULLBACK, [114, 114.5, 104.8, 105.5], [105.5, 106, 103, 104]]);
    expect(i).toMatchObject({ type: "IFVG", direction: "bearish", k: 8, bottom: 104.5, top: 105 });
  });

  it("a wick through the gap is not enough", () => {
    expect(run([...PULLBACK, [114, 114.5, 103, 105.5]]).filter((f) => f.top === 105)).toEqual([]);
  });

  it("mirrors into a bullish IFVG", () => {
    const rows: Bar[] = [...PULLBACK, [114, 114.5, 104.8, 105.5], [105.5, 106, 103, 104]];
    const [i] = run(mirror(rows), mirrorLeg(leg()));
    expect(i).toMatchObject({ type: "IFVG", direction: "bullish", k: 8 });
  });
});
