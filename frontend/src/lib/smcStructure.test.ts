import { describe, expect, it } from "vitest";
import { buildCandles, findSwings, mapStructure } from "./smcStructure";

// Fixtures follow lectures/YTlecture "BOS_ChiCH and inducement". A bar is [open, high, low, close].
type Bar = [number, number, number, number];

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

function bars(rows: Bar[]) {
  return rows.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close }));
}

const swingsOf = (rows: Bar[], kind: "low" | "high") => {
  const c = buildCandles(bars(rows));
  return findSwings(c, 0, c.length - 1, kind).map((s) => s.price);
};
const swingLows = (rows: Bar[]) => swingsOf(rows, "low");

// The same chart upside down: an up-trend becomes a down-trend and every rule must mirror.
const mirror = (rows: Bar[]): Bar[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);

// A long rise from a deep low, so the range stays wide and mapping keeps starting from that low
// even after later bars fall back (the start point depends on where the last close sits).
const PREFIX: Bar[] = [[62, 64, 60, 63], [63, 80, 62, 79], [79, 99, 78, 98]];
const O = PREFIX.length;

// An up-leg with a pullback, a new high, then a fall through the pullback low (the IDM).
const LEG: Bar[] = [
  [100, 101, 99, 100],
  [100, 104, 100, 103],
  [103, 108, 102.5, 107],
  [107, 108.5, 104, 105],
  [105, 106, 101, 102],     // takes the previous low (swing low 101) ...
  [102, 109.5, 102, 109],   // ... and a body close above the dip high confirms it
  [109, 112, 108, 111],     // candidate HH 112
  [111, 111.5, 100.5, 101], // takes the swing low 101 = IDM, HH confirmed
];
const UP_LEG: Bar[] = [...PREFIX, ...LEG];

// Mapping starts from the range low, so the first move up closes through the seed point as a
// ChoCH. That opening mark is the least reliable one (see issue #86); the tests look at what
// follows it.
const OPENING_CHOCH = "ChoCH";
const types = (rows: Bar[]) => mapStructure(bars(rows)).events.map((e) => e.type);

describe("swings (lecture: valid pull-backs)", () => {
  it("1: a candle takes the previous low, a later body close beats the high", () => {
    expect(swingLows([[10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.5, 12.8, 10.5, 11], [11, 14, 10.8, 13.5]])).toEqual([10.5]);
  });

  it("2: an outside bar takes both sides, the next candle must close above its high", () => {
    const base: Bar[] = [[10, 12, 10, 11.5], [11.5, 12.5, 11, 12], [12, 13.5, 10.5, 11]];
    expect(swingLows([...base, [11, 14.2, 10.9, 14]])).toEqual([10.5]);
    expect(swingLows([...base, [11, 14.2, 10.9, 13]])).toEqual([]); // wick above only
  });

  it("3: an inside bar counts as a candle, taking its low makes the swing", () => {
    expect(swingLows([
      [10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.2, 12.8, 11.5, 12], [12, 12.5, 10.8, 11], [11, 14, 10.9, 13.5],
    ])).toEqual([10.8]);
  });

  it("5: bars nested in the inside bar fold into it, the inside bar low still counts", () => {
    expect(swingLows([
      [10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.2, 12.8, 11.5, 12], [12, 12.5, 11.8, 12.2],
      [12, 12.4, 10.8, 11], [11, 14, 10.9, 13.5],
    ])).toEqual([10.8]);
  });

  it("6: a deeper dip supersedes the first one, the close must beat the deeper dip high", () => {
    expect(swingLows([
      [10, 12, 10.2, 11.5], [11.5, 13, 11, 12.5], [12.5, 12.6, 10.6, 10.8], [10.8, 11.2, 10, 10.4], [10.4, 13.2, 10.3, 13],
    ])).toEqual([10]);
  });

  it("a wick above the dip high only moves the level, the next close beyond the wick confirms", () => {
    const rows: Bar[] = [
      [10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.5, 12.8, 10.5, 11], [11, 13.4, 10.9, 12.9], [12.9, 13.2, 12.5, 13],
    ];
    expect(swingLows(rows)).toEqual([]);
    expect(swingLows([...rows, [13, 14.5, 12.9, 14.2]])).toEqual([10.5]);
  });

  it("mirrors into swing highs", () => {
    const rows: Bar[] = [[10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.5, 12.8, 10.5, 11], [11, 14, 10.8, 13.5]];
    expect(swingsOf(mirror(rows), "high")).toEqual([189.5]);
  });
});

describe("swings (lecture: invalid pull-backs)", () => {
  const inside: Bar[] = [[10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.2, 12.8, 11.5, 12]];

  it("taking only the low of a bar nested in the inside bar is not a swing", () => {
    expect(swingLows([...inside, [12, 12.5, 11.8, 12.2], [12.2, 12.6, 11.6, 12.4], [12.4, 14, 12.3, 13.5]])).toEqual([]);
  });

  it("breaking up out of an inside bar without taking its low is not a swing", () => {
    expect(swingLows([...inside, [12, 13.5, 11.9, 13.2]])).toEqual([]);
  });

  it("only touching the previous low is not taking it", () => {
    expect(swingLows([[10, 12, 10, 11.5], [11.5, 13, 11, 12.5], [12.5, 12.8, 11, 12.4], [12.4, 14, 12.3, 13.5]])).toEqual([]);
  });

  it("a steady climb with no low taken has no swing", () => {
    expect(swingLows([[10, 11, 10, 10.8], [10.8, 12, 10.9, 11.8], [11.8, 13, 11.9, 12.8], [12.8, 14, 12.9, 13.8]])).toEqual([]);
  });
});

describe("gaps", () => {
  it("a bounce beneath a gap-down is not a swing high, the swing sits above the gap", () => {
    const rows: Bar[] = [
      [10, 12, 9, 11], [11, 13, 10.5, 12.5],
      [8, 9, 7, 7.5],       // gap down: opens and trades below the previous low
      [7.5, 9.5, 7.2, 7.4], // small bounce that out-tops the gap bar
      [7.4, 7.6, 6, 6.2],
    ];
    expect(swingsOf(rows, "high")).toEqual([13]);
  });
});

describe("mapStructure", () => {
  it("confirms the HH by the IDM, then a body close above it is a BOS", () => {
    const map = mapStructure(bars([...UP_LEG, [101, 114, 100.8, 113]]));
    expect(map.events.map((e) => e.type)).toEqual([OPENING_CHOCH, "IDM", "BOS"]);
    const [, idm, bos] = map.events;
    expect(idm).toMatchObject({ level: 101, direction: "bullish", date: day(O + 7) });
    expect(bos).toMatchObject({ level: 112, direction: "bullish", date: day(O + 8), fromDate: day(O + 6) });
    expect(map.points.map((p) => p.type)).toEqual(["HH", "HL"]);
  });

  it("does not mark an HH before the IDM is taken", () => {
    const map = mapStructure(bars(UP_LEG.slice(0, O + 7)));
    expect(map.points.filter((p) => p.type === "HH")).toEqual([]);
  });

  it("a tap on the IDM is enough, a near miss is not", () => {
    const tap = (low: number): Bar[] => [...UP_LEG.slice(0, O + 7), [111, 111.5, low, 102]];
    expect(types(tap(101))).toContain("IDM");
    expect(types(tap(101.5))).not.toContain("IDM");
  });

  it("a wick through the HH is not a BOS, the level moves to the wick", () => {
    expect(types([...UP_LEG, [101, 114, 100.8, 111.5]])).toEqual([OPENING_CHOCH, "IDM"]);
    // the next body close has to beat the wick (114), not the original 112
    expect(types([...UP_LEG, [101, 114, 100.8, 111.5], [111.5, 113.5, 111, 113]])).toEqual([OPENING_CHOCH, "IDM"]);
    const beat = mapStructure(bars([...UP_LEG, [101, 114, 100.8, 111.5], [111.5, 116, 111, 115]]));
    expect(beat.events.map((e) => e.type)).toEqual([OPENING_CHOCH, "IDM", "BOS"]);
    expect(beat.events[2].level).toBe(114);
  });

  describe("ChoCH", () => {
    // After the BOS the protected HL is 100.5 (the pull-back low on day 7).
    const UP_TREND: Bar[] = [...UP_LEG, [101, 114, 100.8, 113]];
    const WICK: Bar = [113, 113.5, 99, 112];         // low 99 < 100.5, closes back above
    const STILL_ABOVE: Bar = [112, 112.5, 99.5, 100]; // closes under the old HL but above the wick
    const BREAK: Bar = [100, 100.5, 97.5, 98];        // closes under the wick

    it("a body close through the protected HL flips the trend", () => {
      const map = mapStructure(bars([...UP_TREND, [113, 113.5, 98, 99]]));
      const choch = map.events[map.events.length - 1];
      expect(choch).toMatchObject({ type: "ChoCH", direction: "bearish", level: 100.5, date: day(O + 9), fromDate: day(O + 7) });
    });

    it("a wick through the protected HL moves it, the next close must beat the wick", () => {
      expect(types([...UP_TREND, WICK])).toEqual([OPENING_CHOCH, "IDM", "BOS"]);
      expect(types([...UP_TREND, WICK, STILL_ABOVE])).toEqual([OPENING_CHOCH, "IDM", "BOS"]);

      const map = mapStructure(bars([...UP_TREND, WICK, STILL_ABOVE, BREAK]));
      const choch = map.events[map.events.length - 1];
      expect(choch).toMatchObject({ type: "ChoCH", direction: "bearish", level: 99, date: day(O + 11), fromDate: day(O + 9) });
    });

    it("a gap bar that closes through the protected HL is a ChoCH", () => {
      const map = mapStructure(bars([...UP_TREND, [98, 99, 97, 97.5]])); // opens below the previous low
      const choch = map.events[map.events.length - 1];
      expect(choch).toMatchObject({ type: "ChoCH", direction: "bearish", level: 100.5, date: day(O + 9) });
    });

    it("mirrors in a down-trend", () => {
      const rows: Bar[] = [...UP_TREND, WICK, STILL_ABOVE, BREAK];
      const up = mapStructure(bars(rows));
      const down = mapStructure(bars(mirror(rows)));
      expect(down.events.map((e) => [e.type, e.date, 200 - e.level])).toEqual(up.events.map((e) => [e.type, e.date, e.level]));
      expect(down.events.map((e) => e.direction)).toEqual(up.events.map((e) => (e.direction === "bullish" ? "bearish" : "bullish")));
    });
  });
});
