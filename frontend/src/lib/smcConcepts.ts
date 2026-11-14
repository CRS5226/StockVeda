import type { SmcToggles } from "../components/BacktestChart";

export interface Concept {
  key: keyof SmcToggles;
  label: string;
  hint: string;
  legend: { color: string; text: string }[];
  /** A setting of the concept above it: no legend, and left alone by Select all / Clear. */
  option?: boolean;
}

// Grouped as in issue #79; each concept toggles independently.
export const GROUPS: { title: string; concepts: Concept[] }[] = [
  {
    title: "Structure",
    concepts: [
      {
        key: "bos", label: "BOS", hint: "break of structure — body close beyond the confirmed HH / LL",
        legend: [
          { color: "bg-emerald-600", text: "BOS · bullish — closes above the HH, up-trend continues" },
          { color: "bg-red-600", text: "BOS · bearish — closes below the LL, down-trend continues" },
        ],
      },
      {
        key: "choch", label: "ChoCH", hint: "change of character — body close beyond the protected HL / LH",
        legend: [
          { color: "bg-emerald-600", text: "ChoCH · bullish — dashed, closes through the protected LH, trend turns up" },
          { color: "bg-red-600", text: "ChoCH · bearish — dashed, closes through the protected HL, trend turns down" },
        ],
      },
      {
        key: "cisd", label: "CISD", hint: "change in state of delivery — body close back through the open of the last run's first candle; no swing break needed",
        legend: [
          { color: "bg-emerald-600", text: "CISD · bullish — dotted, closes above the open of the last down run" },
          { color: "bg-red-600", text: "CISD · bearish — dotted, closes below the open of the last up run" },
        ],
      },
      {
        key: "idm", label: "IDM", hint: "inducement — nearest swing left of a high/low; taking it confirms the HH / LL",
        legend: [{ color: "bg-fuchsia-500", text: "IDM — inducement swing, drawn to the bar that took it" }],
      },
      {
        key: "points", label: "HH / HL / LH / LL", hint: "structure points, shown only once confirmed (HH/LL by IDM, HL/LH by BOS)",
        legend: [
          { color: "bg-green-700", text: "HH · HL — up-trend points" },
          { color: "bg-red-700", text: "LH · LL — down-trend points" },
        ],
      },
    ],
  },
  {
    title: "Blocks",
    concepts: [
      {
        key: "orderBlocks", label: "Order blocks (with FVG)",
        hint: "last selling / buying candle in the IDM → HL / LH pullback that has an FVG on its far side",
        legend: [
          { color: "bg-emerald-600", text: "Bullish OB (green zone), CE dotted at its 50%" },
          { color: "bg-red-600", text: "Bearish OB (red zone), CE dotted at its 50%" },
        ],
      },
      {
        key: "advancedBlocks", label: "Advanced order blocks (no FVG)",
        hint: "run of same-colour candles before the move; a body close past its 50% invalidates it",
        legend: [
          { color: "bg-teal-500", text: "Bullish advanced OB (teal zone), 50% dotted" },
          { color: "bg-orange-500", text: "Bearish advanced OB (orange zone), 50% dotted" },
        ],
      },
      {
        key: "fourCandle", label: "4-candle filter", option: true, legend: [],
        hint: "only blocks whose 4th following candle closes beyond the block (blocks too recent to judge stay)",
      },
      {
        key: "showMitigated", label: "Show mitigated", option: true, legend: [],
        hint: "keep fully mitigated blocks and filled FVGs, drawn up to the bar that ended them",
      },
      {
        key: "breaker", label: "Breaker block", hint: "order block that failed, then flips polarity on a retest",
        legend: [{ color: "bg-orange-500", text: "BRK — breaker (block failed, now flips)" }],
      },
      {
        key: "reclaimed", label: "Reclaimed block", hint: "order block broken, then price closed back on its original side",
        legend: [{ color: "bg-lime-600", text: "RCL — reclaimed (block held after a break)" }],
      },
      {
        key: "mitigation", label: "Mitigation block", hint: "order block that absorbed price on a revisit, as intended",
        legend: [{ color: "bg-slate-500", text: "MIT — mitigation (block absorbed price)" }],
      },
    ],
  },
  {
    title: "Liquidity & imbalance",
    concepts: [
      {
        key: "liquidity", label: "Liquidity", hint: "equal highs/lows and sweeps",
        legend: [{ color: "bg-cyan-500", text: "EQH / EQL — equal highs / lows · SWEEP — liquidity grab" }],
      },
      {
        key: "fvg", label: "FVG (all)",
        hint: "gap between candle 1 and candle 3 along the IDM → HL / LH leg; the one under an order block is bold, the rest dim",
        legend: [
          { color: "bg-blue-500", text: "FVG — plain gap, CE dotted at its 50%" },
        ],
      },
      {
        key: "pfg", label: "PFG", hint: "perfect — small third candle that holds the middle candle's close; best chance of a retest",
        legend: [{ color: "bg-violet-500", text: "PFG — perfect FVG" }],
      },
      {
        key: "bfg", label: "BFG", hint: "breakaway — large third candle closing beyond the middle one; strong momentum, rarely retraces",
        legend: [{ color: "bg-orange-500", text: "BFG — breakaway FVG" }],
      },
      {
        key: "rfg", label: "RFG", hint: "rejection — third candle closes back into the middle one; weakening momentum",
        legend: [{ color: "bg-teal-500", text: "RFG — rejection FVG" }],
      },
      {
        key: "ifvg", label: "IFVG", hint: "inverse — a gap price closed through; it now works the other way",
        legend: [{ color: "bg-yellow-500", text: "IFVG — a gap price closed through" }],
      },
    ],
  },
];
