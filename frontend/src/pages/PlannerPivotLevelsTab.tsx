import { useEffect, useState } from "react";
import type { PlannerPrefill } from "../lib/api";

function fmt(n: number) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const inputCls = "w-full text-sm border border-blue-200 bg-blue-50/60 rounded px-2 py-1.5 font-medium text-slate-800";

function classicLevels(h: number, l: number, c: number) {
  const pp = (h + l + c) / 3;
  return {
    pp,
    r1: 2 * pp - l, s1: 2 * pp - h,
    r2: pp + (h - l), s2: pp - (h - l),
    r3: h + 2 * (pp - l), s3: l - 2 * (h - pp),
  };
}

function fibLevels(h: number, l: number, c: number) {
  const pp = (h + l + c) / 3;
  const range = h - l;
  return {
    pp,
    r1: pp + 0.382 * range, s1: pp - 0.382 * range,
    r2: pp + 0.618 * range, s2: pp - 0.618 * range,
    r3: pp + 1.0 * range, s3: pp - 1.0 * range,
  };
}

function camarillaLevels(h: number, l: number, c: number) {
  const range = h - l;
  return {
    r1: c + (range * 1.1) / 12, s1: c - (range * 1.1) / 12,
    r2: c + (range * 1.1) / 6, s2: c - (range * 1.1) / 6,
    r3: c + (range * 1.1) / 4, s3: c - (range * 1.1) / 4,
    r4: c + (range * 1.1) / 2, s4: c - (range * 1.1) / 2,
  };
}

function LevelCard({ title, rows }: { title: string; rows: { label: string; value: number; kind: "r" | "s" | "pp" }[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="text-xs font-semibold text-slate-500 mb-3">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${
            r.kind === "pp" ? "bg-blue-50 font-semibold text-blue-700" :
            r.kind === "r" ? "text-emerald-600" : "text-red-500"}`}>
            <span>{r.label}</span>
            <span className="font-mono font-medium">₹{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlannerPivotLevelsTab({ prefill }: { prefill: PlannerPrefill | null }) {
  const [high, setHigh] = useState(0);
  const [low, setLow] = useState(0);
  const [close, setClose] = useState(0);
  const [weekEnding, setWeekEnding] = useState<string | null>(null);

  useEffect(() => {
    if (!prefill?.prev_week) return;
    setHigh(prefill.prev_week.high);
    setLow(prefill.prev_week.low);
    setClose(prefill.prev_week.close);
    setWeekEnding(prefill.prev_week.week_ending_date);
  }, [prefill]);

  const classic = classicLevels(high, low, close);
  const fib = fibLevels(high, low, close);
  const cam = camarillaLevels(high, low, close);

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="text-xs font-semibold text-slate-500 mb-1">Reference period H / L / C</div>
        <div className="text-[10px] text-slate-400 mb-3">
          For swing trades, use the previous completed week's High/Low/Close.
          {weekEnding && <span> Prefilled from week ending {weekEnding.slice(0, 10)}.</span>}
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-md">
          <label className="text-xs text-slate-500">
            <div className="mb-1">High (₹)</div>
            <input type="number" step={0.05} value={high} onChange={(e) => setHigh(parseFloat(e.target.value) || 0)} className={inputCls} />
          </label>
          <label className="text-xs text-slate-500">
            <div className="mb-1">Low (₹)</div>
            <input type="number" step={0.05} value={low} onChange={(e) => setLow(parseFloat(e.target.value) || 0)} className={inputCls} />
          </label>
          <label className="text-xs text-slate-500">
            <div className="mb-1">Close (₹)</div>
            <input type="number" step={0.05} value={close} onChange={(e) => setClose(parseFloat(e.target.value) || 0)} className={inputCls} />
          </label>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LevelCard title="Classic" rows={[
          { label: "R3", value: classic.r3, kind: "r" }, { label: "R2", value: classic.r2, kind: "r" }, { label: "R1", value: classic.r1, kind: "r" },
          { label: "PP", value: classic.pp, kind: "pp" },
          { label: "S1", value: classic.s1, kind: "s" }, { label: "S2", value: classic.s2, kind: "s" }, { label: "S3", value: classic.s3, kind: "s" },
        ]} />
        <LevelCard title="Fibonacci" rows={[
          { label: "R3", value: fib.r3, kind: "r" }, { label: "R2", value: fib.r2, kind: "r" }, { label: "R1", value: fib.r1, kind: "r" },
          { label: "PP", value: fib.pp, kind: "pp" },
          { label: "S1", value: fib.s1, kind: "s" }, { label: "S2", value: fib.s2, kind: "s" }, { label: "S3", value: fib.s3, kind: "s" },
        ]} />
        <LevelCard title="Camarilla" rows={[
          { label: "R4", value: cam.r4, kind: "r" }, { label: "R3", value: cam.r3, kind: "r" },
          { label: "R2", value: cam.r2, kind: "r" }, { label: "R1", value: cam.r1, kind: "r" },
          { label: "Close", value: close, kind: "pp" },
          { label: "S1", value: cam.s1, kind: "s" }, { label: "S2", value: cam.s2, kind: "s" },
          { label: "S3", value: cam.s3, kind: "s" }, { label: "S4", value: cam.s4, kind: "s" },
        ]} />
      </div>
    </div>
  );
}
