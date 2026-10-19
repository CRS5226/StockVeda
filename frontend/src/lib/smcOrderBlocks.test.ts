import { describe, expect, it } from "vitest";
import { detectLegBlocks } from "./smcOrderBlocks";
import { buildCandles, type StructureLeg } from "./smcStructure";

// A bar is [open, high, low, close]. Fixtures follow lectures/YTlecture "order block / FVG / order flow".
type Bar = [number, number, number, number];

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const candles = (rows: Bar[]) =>
  buildCandles(rows.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close })));
const mirror = (rows: Bar[]): Bar[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);

const leg = (over: Partial<StructureLeg>): StructureLeg => ({
  direction: "bullish", idm: { k: 0, price: 0 }, extreme: { k: 0, price: 113 },
  protected: { k: 3, price: 100 }, from: 1, to: 3, open: false, ...over,
});
// the same leg seen from the other side of the chart
const mirrorLeg = (l: StructureLeg): StructureLeg => ({
  ...l, direction: "bearish",
  idm: { ...l.idm, price: 200 - l.idm.price }, extreme: { ...l.extreme, price: 200 - l.extreme.price },
  protected: { ...l.protected, price: 200 - l.protected.price },
});

// Pullback to a low of 100, then a displacement candle that leaves an FVG (104.5 -> 105) above it.
const PULLBACK: Bar[] = [
  [110, 112, 108, 111],
  [111, 111, 105, 106],      // took the IDM
  [106, 107, 103, 104],
  [104, 104.5, 100, 101],    // the HL
  [101, 106, 100.5, 105],    // displacement
  [105, 109, 105, 108.8],    // low 105 > 104.5: FVG above the HL candle
  [108.8, 115, 108, 114],    // back at the HH
];

describe("order blocks in a leg", () => {
  it("the candle at the HL is the block when an FVG sits above it", () => {
    const blocks = detectLegBlocks(candles(PULLBACK), leg({}));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      direction: "bullish", role: "extreme", k: 3, date: day(3), top: 104.5, bottom: 100,
      fvg: { top: 105, bottom: 104.5, endK: 5 },
    });
  });

  it("without an FVG above it the block shifts to the next candle that has one", () => {
    const rows = PULLBACK.map((r) => [...r] as Bar);
    rows[5] = [105, 109, 104, 108.8];   // low 104 < 104.5: no FVG on the HL candle any more
    rows[6] = [108.8, 115, 108, 114];   // but candle 4 (high 106) now has one below candle 6 (low 108)
    const [block] = detectLegBlocks(candles(rows), leg({}));
    expect(block).toMatchObject({ k: 4, top: 106, bottom: 100.5, fvg: { top: 108, bottom: 106 } });
  });

  it("no FVG anywhere in the move means no block", () => {
    const rows = PULLBACK.map((r) => [...r] as Bar);
    rows[5] = [105, 109, 104, 108.8];
    rows[6] = [108.8, 115, 104.8, 114];
    expect(detectLegBlocks(candles(rows), leg({}))).toEqual([]);
  });

  it("colour does not matter: a candle that closed up can be the block", () => {
    const rows = PULLBACK.map((r) => [...r] as Bar);
    rows[3] = [100.5, 104.5, 100, 104.2]; // lowest low, closes up
    expect(detectLegBlocks(candles(rows), leg({}))[0]).toMatchObject({ k: 3, bottom: 100 });
  });

  it("keeps only the block nearest the IDM and the one at the HL, not those in between", () => {
    const rows: Bar[] = [
      [110, 112, 108, 111],
      [111, 111, 106, 107],        // took the IDM
      [107, 107.5, 102, 103],      // first pullback low
      [103, 112, 102.5, 111.5],    // closes above the dip high: a valid swing low
      [111.5, 113, 108, 112.5],    // low 108 > 107.5: FVG above candle 2
      [112.5, 112.6, 104, 105],    // another dip, not a valid swing: ignored
      [105, 105.5, 101, 101.5],    // the HL
      [101.5, 107, 101.2, 106.5],
      [106.5, 110, 106, 109.5],    // low 106 > 105.5: FVG above the HL candle
    ];
    const l = leg({ extreme: { k: 0, price: 120 }, from: 1, to: 6, protected: { k: 6, price: 101 } });
    const blocks = detectLegBlocks(candles(rows), l);
    expect(blocks.map((b) => [b.role, b.k, b.top, b.bottom])).toEqual([
      ["nearIdm", 2, 107.5, 102],
      ["extreme", 6, 105.5, 101],
    ]);
  });

  it("mirrors into bearish blocks", () => {
    const up = detectLegBlocks(candles(PULLBACK), leg({}));
    const down = detectLegBlocks(candles(mirror(PULLBACK)), mirrorLeg(leg({})));
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ direction: "bearish", k: up[0].k, role: up[0].role });
    expect([200 - down[0].bottom, 200 - down[0].top]).toEqual([up[0].top, up[0].bottom]);
    expect([200 - down[0].fvg.bottom, 200 - down[0].fvg.top]).toEqual([up[0].fvg.top, up[0].fvg.bottom]);
  });
});
