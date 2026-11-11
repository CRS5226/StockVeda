import { describe, expect, it } from "vitest";
import { dropCoveredIfvgs, detectSwingCombinedBlocks, detectSwingFvgs, detectSwingOrderBlocks, detectSwingTypedBlocks } from "./smcSwingZones";
import type { Fvg } from "./smcFvg";

// A bar is [open, high, low, close]. Swing length 1 keeps the fixtures short.
type Bar = [number, number, number, number];

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const bars = (rows: Bar[]) => rows.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close }));
const mirror = (rows: Bar[]): Bar[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);
const blocks = (rows: Bar[]) => detectSwingOrderBlocks(bars(rows), { length: 1 });
const gaps = (rows: Bar[]) => detectSwingFvgs(bars(rows), { length: 1 });

// Swing high 13 (bar 1), a bearish candle (bar 3) that makes the swing low 8, then a close above 13.
const LEG: Bar[] = [
  [10, 11, 9, 10],
  [10, 13, 10, 12],
  [12, 12, 10, 11],
  [11, 11.5, 8, 9],   // last bearish candle before the impulse: the order block, range 8 - 11.5
  [9, 11, 9, 10],
  [10, 14, 10, 14],   // body close above 13: BOS
];

describe("detectSwingOrderBlocks", () => {
  it("takes the pivot candle of the leg as a single candle, full range with a CE", () => {
    const [b] = blocks([...LEG, [14, 15, 12, 15], [15, 16, 14, 16]]);
    expect(b).toMatchObject({ direction: "bullish", date: day(3), top: 11.5, bottom: 8, ce: 9.75, status: "unmitigated" });
  });

  it("uses the pivot candle whatever its colour", () => {
    const bullishPivot: Bar[] = LEG.map((r, i) => (i === 3 ? [9, 11.5, 8, 10.5] : r)); // same range, closes up
    const [b] = blocks(bullishPivot);
    expect(b).toMatchObject({ direction: "bullish", date: day(3), top: 11.5, bottom: 8 });
  });

  it("applies the 4-candle rule on the 4th candle after the block", () => {
    expect(blocks([...LEG, [14, 15, 12, 15], [15, 16, 14, 16]])[0].followThrough).toBe(true);
    expect(blocks(LEG)[0].followThrough).toBeNull(); // the 4th candle has not formed yet
  });

  it("calls a wick into the block that holds partial", () => {
    const [b] = blocks([...LEG, [14, 14, 10, 12], [12, 13, 11, 13]]);
    expect(b.status).toBe("partial");
  });

  it("invalidates the block when a candle closes through its far side", () => {
    const [b] = blocks([...LEG, [14, 14, 10, 11], [11, 11, 7, 7.5]]);
    expect(b.status).toBe("full");
    expect(b.endDate).toBe(day(7));
  });

  it("mirrors for a bearish break", () => {
    const [b] = blocks(mirror([...LEG, [14, 15, 12, 15], [15, 16, 14, 16]]));
    expect(b).toMatchObject({ direction: "bearish", date: day(3), top: 192, bottom: 188.5, ce: 190.25 });
  });

  it("finds nothing without a break", () => {
    expect(blocks(LEG.slice(0, 5))).toEqual([]);
  });
});

describe("detectSwingFvgs", () => {
  // Candle 1 (bar 3) high 11.5, candle 3 (bar 5) low 12.5: a gap of 11.5 - 12.5 left by the displacement.
  const GAP: Bar[] = [
    [10, 11, 9, 10],
    [10, 13, 10, 12],
    [12, 12, 10, 11],
    [11, 11.5, 8, 9],
    [9, 12, 9, 12],
    [12, 15, 12.5, 15],
  ];

  it("plots the gap between candle 1's wick and candle 3's wick inside the leg", () => {
    const f = gaps(GAP);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ direction: "bullish", top: 12.5, bottom: 11.5, ce: 12, type: "BFG", attached: true, status: "unmitigated" });
  });

  it("finds a gap anywhere in the leg, and only bolds the one that opens at the order block", () => {
    const later: Bar[] = [
      [10, 11, 9, 10],
      [10, 13, 10, 12],
      [12, 12, 10, 11],
      [11, 11.5, 8, 9],     // pivot candle: the order block
      [9, 10, 9, 9.8],
      [9.8, 11, 9.5, 10.8],
      [10.8, 14, 10.5, 14], // gap 10 - 10.5 between bars 4 and 6, away from the block; closes above 13
    ];
    const f = gaps(later);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ top: 10.5, bottom: 10, date: day(4), attached: false });
  });

  it("draws an IFVG from the candles where the gap formed, and marks the candle that closed through it", () => {
    const f = gaps([...GAP, [15, 15, 10, 10.5]]); // bar 6 closes below the gap's bottom (11.5)
    const i = f.find((x) => x.type === "IFVG");
    expect(i).toMatchObject({ direction: "bearish", top: 12.5, bottom: 11.5, date: day(3), invertedDate: day(6) });
  });

  it("finds no gap when the candles overlap", () => {
    expect(gaps(LEG)).toEqual([]);
  });

  it("mirrors for a bearish break", () => {
    const [f] = gaps(mirror(GAP));
    expect(f).toMatchObject({ direction: "bearish", top: 188.5, bottom: 187.5 });
  });
});

describe("detectSwingTypedBlocks", () => {
  const typed = (rows: Bar[]) => detectSwingTypedBlocks(bars(rows), { length: 1 });

  // Swing low 7 (bar 1), swing high 15 (bar 3, the candle that is later broken), a dip to 6 that takes the
  // low at 7 (bar 5), then a close at 16 above the 15.
  const SWEEP: Bar[] = [
    [10, 11, 9.5, 10.5],
    [10.5, 11, 7, 8],
    [8, 12, 8, 11.5],
    [11.5, 15, 11, 14],
    [14, 14, 10, 10.5],
    [10.5, 11, 6, 6.5],
    [6.5, 13, 6.5, 12.5],
    [12.5, 16, 12, 16],
  ];
  // The same, but the dip stops at 8.5: it never takes the low at 7 (a higher low).
  const FAILURE: Bar[] = SWEEP.map((r, i) => (i === 5 ? [10.5, 11, 8.5, 9] : i === 6 ? [9, 13, 8.8, 12.5] : r));

  it("makes a breaker of the broken candle when the leg first took the previous swing low", () => {
    const b = typed(SWEEP).filter((x) => x.kind === "breaker");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ direction: "bullish", date: day(3), top: 15, bottom: 11, ce: 13, status: "unmitigated" });
  });

  it("makes a mitigation block of it when the leg held above the previous swing low", () => {
    const m = typed(FAILURE).filter((x) => x.kind === "mitigation");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ direction: "bullish", date: day(3), top: 15, bottom: 11 });
    expect(typed(FAILURE).some((x) => x.kind === "breaker")).toBe(false);
  });

  it("mirrors for a bearish break", () => {
    const b = typed(mirror(SWEEP)).filter((x) => x.kind === "breaker");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ direction: "bearish", top: 189, bottom: 185 });
  });

  it("retires the zone when a candle closes through its far side", () => {
    const [b] = typed([...SWEEP, [16, 16, 9, 10]]).filter((x) => x.kind === "breaker"); // closes below 11
    expect(b.status).toBe("full");
    expect(b.endDate).toBe(day(8));
  });

  it("makes a rejection block of a pivot candle with a wick of at least 40%, wick zone only", () => {
    const rows: Bar[] = LEG.map((r, i) => (i === 3 ? [10, 11.5, 8, 10.2] : r)); // lower wick 10 - 8 = 2 of a 3.5 range
    const r = typed(rows).filter((x) => x.kind === "rejection");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ direction: "bullish", date: day(3), top: 10, bottom: 8, ce: 9 });
  });

  it("makes no rejection block when the wick is under 40% of the range", () => {
    expect(typed(LEG).some((x) => x.kind === "rejection")).toBe(false); // wick 1 of a 3.5 range
  });
});

describe("dropCoveredIfvgs", () => {
  const gap = (type: Fvg["type"], direction: Fvg["direction"], bottom: number, top: number): Fvg => ({
    type, direction, k: 0, date: day(0), top, bottom, ce: (top + bottom) / 2, status: "unmitigated", ceBroken: false,
    endK: 9, endDate: day(9), attached: false, leg: 0,
  });

  it("drops an IFVG already covered by a same-direction gap", () => {
    expect(dropCoveredIfvgs([gap("FVG", "bearish", 100, 110)], [gap("IFVG", "bearish", 101, 109)])).toEqual([]);
  });

  it("keeps an IFVG over a gap of the other direction, or in a different band", () => {
    const kept = dropCoveredIfvgs(
      [gap("FVG", "bullish", 100, 110)],
      [gap("IFVG", "bearish", 101, 109), gap("IFVG", "bearish", 150, 160)],
    );
    expect(kept.map((x) => x.bottom)).toEqual([101, 150]);
  });

  it("keeps only the first of two IFVGs on the same band", () => {
    const kept = dropCoveredIfvgs([], [gap("IFVG", "bullish", 100, 110), gap("IFVG", "bullish", 102, 112)]);
    expect(kept).toHaveLength(1);
    expect(kept[0].bottom).toBe(100);
  });
});

describe("detectSwingCombinedBlocks", () => {
  const combined = (rows: Bar[]) => detectSwingCombinedBlocks(bars(rows), { length: 1 });
  // Order block (bar 3, range 8 - 11.5) with a gap 11.5 - 12.5 opening at it.
  const GAP: Bar[] = [
    [10, 11, 9, 10],
    [10, 13, 10, 12],
    [12, 12, 10, 11],
    [11, 11.5, 8, 9],
    [9, 12, 9, 12],
    [12, 15, 12.5, 15],
  ];

  it("joins an order block and the FVG that opens at it into one zone", () => {
    const [c] = combined(GAP);
    expect(c).toMatchObject({ direction: "bullish", date: day(3), top: 12.5, bottom: 8, ce: 10.25, fvgType: "BFG", status: "unmitigated" });
  });

  it("mirrors for a bearish break", () => {
    const [c] = combined(mirror(GAP));
    expect(c).toMatchObject({ direction: "bearish", top: 192, bottom: 187.5 });
  });

  it("takes status and end from the order block", () => {
    const [c] = combined([...GAP, [15, 15, 7, 7.5]]); // closes through the block's far side (8)
    expect(c.status).toBe("full");
    expect(c.endDate).toBe(day(6));
  });

  it("finds nothing when the gap is away from the order block", () => {
    const away: Bar[] = [
      [10, 11, 9, 10],
      [10, 13, 10, 12],
      [12, 12, 10, 11],
      [11, 11.5, 8, 9],
      [9, 10, 9, 9.8],
      [9.8, 11, 9.5, 10.8],
      [10.8, 14, 10.5, 14],
    ];
    expect(combined(away)).toEqual([]);
  });
});
