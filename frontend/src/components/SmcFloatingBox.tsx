import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripHorizontal, X } from "lucide-react";
import type { SmcToggles } from "./BacktestChart";
import { GROUPS, type Concept } from "../lib/smcConcepts";
import type { StructureSettings } from "../lib/smcPrefs";

interface Category {
  id: string;
  title: string;
  /** Concepts shown for this category, in order. Options (4-candle filter, show mitigated) ride along. */
  keys: (keyof SmcToggles)[];
}

// Left-hand categories of the box; each key is a concept defined in lib/smcConcepts.ts.
const CATEGORIES: Category[] = [
  { id: "structure", title: "Structure", keys: ["bos", "choch", "cisd", "points", "swingLines", "swingLevels"] },
  {
    id: "ob", title: "Order blocks",
    keys: ["orderBlocks", "obFvg", "rejection", "breaker", "mitigation", "showMitigated"],
  },
  { id: "fvg", title: "FVG", keys: ["fvg", "pfg", "bfg", "rfg", "ifvg", "showMitigated"] },
  { id: "liquidity", title: "Liquidity", keys: ["liquidity"] },
];

// On the Charts page the structure points are plain swings, so they get their own wording
// (the shared concept text describes the lecture rules).
const CHARTS_TEXT: Partial<Record<keyof SmcToggles, { label: string; hint: string; legend?: Concept["legend"] }>> = {
  breaker: {
    label: "Breaker block",
    hint: "the candle at the swing a break ran through, when the leg first took the previous swing low / high (liquidity sweep); the zone flips and holds price on a retest",
    legend: [{ color: "bg-pink-500", text: "BRK — breaker (sweep, then structure break; zone flips)" }],
  },
  mitigation: {
    label: "Mitigation block",
    hint: "the candle at the swing a break ran through, when the leg held above the previous swing low / below the previous high (failure swing, no sweep); retested as support / resistance",
    legend: [{ color: "bg-slate-500", text: "MIT — mitigation (failure swing, no sweep)" }],
  },
  orderBlocks: {
    label: "Order blocks",
    hint: "the pivot candle of the leg that broke structure (its lowest low / highest high); full range, CE dotted at 50%. Only kept when the 4th candle after it closes beyond it",
  },
  showMitigated: {
    label: "Show invalidated",
    hint: "keep blocks a candle has closed through (and filled FVGs), drawn up to the bar that ended them",
  },
  fvg: {
    label: "FVG (all)",
    hint: "gap between candle 1's wick and candle 3's wick anywhere in the leg that broke structure; bold when it opens at the order block",
  },
  points: {
    label: "Swings (HH / HL / LH / LL)",
    hint: "every confirmed swing high / low, tagged against the previous swing of the same side",
  },
};

// Concepts that exist only on the Charts page (the lecture-based Backtest tab has no swing hierarchy).
const EXTRA_CONCEPTS: Concept[] = [
  {
    key: "obFvg", label: "OB + FVG",
    hint: "an order block together with the FVG that opens at it, drawn as one zone from the block's far edge to the gap's far edge",
    legend: [{ color: "bg-fuchsia-500", text: "OB+FVG — order block with its FVG, CE dotted at 50%" }],
  },
  {
    key: "rejection", label: "Rejection block",
    hint: "the pivot candle's wick when it is at least 40% of the candle's range; only the wick is the zone (low to body bottom, or body top to high)",
    legend: [{ color: "bg-lime-500", text: "REJ — rejection (wick zone), CE dotted at 50%" }],
  },
  {
    key: "swingLines", label: "Swing lines (zigzag)",
    hint: "one line joining the swings in order, so the HH / HL / LH / LL path is easy to follow",
    legend: [{ color: "bg-slate-500", text: "Zigzag through the swing highs and lows" }],
  },
  {
    key: "swingLevels", label: "Swing levels (ITH / LTH)",
    hint: "intermediate and long-term swings: an ITH has a lower short-term high each side, an LTH a lower ITH each side (lows mirror)",
    legend: [{ color: "bg-amber-600", text: "ITH / ITL · LTH / LTL" }],
  },
];

const CONCEPTS = new Map<keyof SmcToggles, Concept>(
  [...GROUPS.flatMap((g) => g.concepts), ...EXTRA_CONCEPTS].map((c) => [c.key, { ...c, ...CHARTS_TEXT[c.key] }] as const),
);

interface Props {
  smc: SmcToggles;
  onChange: (next: SmcToggles) => void;
  onClose: () => void;
  dark: boolean;
  structure: StructureSettings;
  onStructureChange: (next: StructureSettings) => void;
}

/**
 * Small draggable box that floats over the chart. Categories on the left, the items of the chosen
 * category on the right; each tick is applied to the chart straight away.
 */
export default function SmcFloatingBox({ smc, onChange, onClose, dark, structure, onStructureChange }: Props) {
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState({ x: 16, y: 48 });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const category = CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0];
  const items = category.keys.map((k) => CONCEPTS.get(k)).filter((c): c is Concept => !!c);
  const mainItems = items.filter((c) => !c.option);

  const countOn = (cat: Category) => cat.keys.filter((k) => !CONCEPTS.get(k)?.option && smc[k]).length;
  const toggle = (key: keyof SmcToggles) => onChange({ ...smc, [key]: !smc[key] });
  const setMain = (value: boolean) => {
    const next = { ...smc };
    mainItems.forEach((c) => { next[c.key] = value; });
    onChange(next);
  };

  // Drag by the header, kept inside the chart area (the box's offset parent).
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const parent = boxRef.current?.offsetParent as HTMLElement | null;
    const box = boxRef.current;
    const maxX = parent && box ? parent.clientWidth - box.offsetWidth : Infinity;
    const maxY = parent && box ? parent.clientHeight - box.offsetHeight : Infinity;
    setPos({
      x: Math.max(0, Math.min(maxX, e.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(maxY, e.clientY - drag.current.dy)),
    });
  };
  const onPointerUp = () => { drag.current = null; };

  const shell = dark ? "bg-[#1e222d] border-[#2a2e39] text-slate-200" : "bg-white border-slate-200 text-slate-700";
  const divider = dark ? "border-[#2a2e39]" : "border-slate-200";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const hover = dark ? "hover:bg-[#2a2e39]" : "hover:bg-slate-100";

  return (
    <div ref={boxRef} style={{ left: pos.x, top: pos.y }}
      className={`absolute z-20 w-[430px] max-w-[calc(100%-16px)] rounded-lg border shadow-xl text-xs ${shell}`}>
      {/* Header: drag handle */}
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        className={`flex items-center gap-2 px-3 py-2 cursor-move select-none ${collapsed ? "" : `border-b ${divider}`}`}>
        <GripHorizontal size={14} className={muted} />
        <span className="font-semibold text-sm">SMC</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"}
            className={`p-1 rounded ${hover}`}>
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={onClose} title="Close" className={`p-1 rounded ${hover}`}><X size={14} /></button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex h-72">
          {/* Left: categories */}
          <div className={`w-32 shrink-0 border-r ${divider} py-1 overflow-y-auto`}>
            {CATEGORIES.map((c) => {
              const n = countOn(c);
              const active = c.id === category.id;
              return (
                <button key={c.id} onClick={() => setCategoryId(c.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left font-medium transition-colors ${
                    active ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600") : `${muted} ${hover}`
                  }`}>
                  {c.title}
                  {n > 0 && (
                    <span className={`min-w-4 px-1 rounded-full text-[10px] text-center ${dark ? "bg-blue-500/30 text-blue-300" : "bg-blue-100 text-blue-700"}`}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right: items of the chosen category */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className={`flex items-center justify-between px-3 py-1.5 border-b ${divider}`}>
              <span className={`font-semibold ${muted}`}>{category.title}</span>
              <span className="flex gap-2">
                <button onClick={() => setMain(true)} className="text-blue-500 hover:underline">All</button>
                <button onClick={() => setMain(false)} className={`${muted} hover:underline`}>None</button>
              </span>
            </div>
            {category.id === "structure" && (
              <div className={`px-3 py-2 border-b ${divider} space-y-1.5`}>
                <label className={`flex items-center gap-2 ${muted}`} title="Bars each side a swing must out-reach. Smaller = more swings and breaks.">
                  Swing length
                  <input type="number" min={1} max={20} value={structure.length}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value));
                      if (v >= 1 && v <= 20) onStructureChange({ length: v });
                    }}
                    className={`w-12 px-1 py-0.5 rounded border text-center ${dark ? "bg-[#131722] border-[#2a2e39] text-slate-200" : "bg-white border-slate-200 text-slate-700"}`} />
                </label>
                <div className={`text-[10px] leading-snug ${muted}`}>
                  Every confirmed swing counts: a body close beyond the latest swing is a BOS (with the trend) or a ChoCH (against it).
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto py-1">
              {items.map((c) => (
                <label key={`${category.id}-${c.key}`} title={c.hint}
                  className={`flex items-start gap-2 px-3 py-1.5 cursor-pointer ${hover} ${c.option ? "pl-6" : ""}`}>
                  <input type="checkbox" checked={smc[c.key]} onChange={() => toggle(c.key)}
                    className="mt-0.5 accent-blue-600" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      {c.legend[0] && <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${c.legend[0].color}`} />}
                      {c.label}
                    </span>
                    <span className={`block text-[10px] leading-snug ${muted}`}>{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
