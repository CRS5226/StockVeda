import { useEffect, useMemo, useState } from "react";
import type { PlannerPrefill } from "../lib/api";

function fmt(n: number, dec = 2) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

const PILL: Record<string, string> = {
  OK: "bg-emerald-500 text-white",
  REJECT: "bg-red-500 text-white",
  GO: "bg-emerald-600 text-white",
  SKIP: "bg-red-600 text-white",
};

const inputCls = "w-full text-sm border border-blue-200 bg-blue-50/60 rounded px-2 py-1.5 font-medium text-slate-800";
const outCls = "w-full text-sm border border-slate-200 bg-slate-50 rounded px-2 py-1.5 font-semibold text-slate-700";

export default function PlannerCalculatorTab({ prefill }: { prefill: PlannerPrefill | null }) {
  const [capital, setCapital] = useState(500000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState(0);
  const [zone, setZone] = useState(0);
  const [atr, setAtr] = useState(0);
  const [atrMult, setAtrMult] = useState(0.5);
  const [target1, setTarget1] = useState(0);
  const [target2, setTarget2] = useState(0);
  const [slOverride, setSlOverride] = useState("");

  // Apply prefill once per fetch — entry/ATR only; zone/targets aren't derivable
  // from a single price series, stay whatever the user last typed.
  useEffect(() => {
    if (!prefill) return;
    setEntry(prefill.last_close);
    if (prefill.atr_14 != null) setAtr(Math.round(prefill.atr_14 * 100) / 100);
  }, [prefill]);

  const isLong = direction === "long";

  const suggestedSL = useMemo(() => (
    isLong ? zone - atr * atrMult : zone + atr * atrMult
  ), [isLong, zone, atr, atrMult]);

  const slUsed = useMemo(() => {
    const v = parseFloat(slOverride);
    return slOverride.trim() !== "" && !isNaN(v) ? v : suggestedSL;
  }, [slOverride, suggestedSL]);

  const riskPerShare = Math.abs(entry - slUsed);
  const slDistancePct = entry > 0 ? (riskPerShare / entry) * 100 : 0;
  const maxRiskAmount = capital * (riskPct / 100);
  const quantity = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : 0;
  const positionValue = quantity * entry;
  const positionPctOfCapital = capital > 0 ? (positionValue / capital) * 100 : 0;
  const actualRisk = quantity * riskPerShare;

  const rewardT1 = Math.abs(target1 - entry);
  const rewardT2 = Math.abs(target2 - entry);
  const rrT1 = riskPerShare > 0 ? rewardT1 / riskPerShare : 0;
  const rrT2 = riskPerShare > 0 ? rewardT2 / riskPerShare : 0;
  const profitT1 = quantity * rewardT1;
  const profitT2 = quantity * rewardT2;

  const ladder = [1, 2, 3, 4].map((n) => entry + (isLong ? 1 : -1) * n * riskPerShare);

  // Verdict thresholds are designed defaults (the source spec gave labels/example
  // output but not exact numbers) — tune here if needed.
  const rrOk = rrT1 >= 2.0;
  const riskSizeOk = riskPct <= 2.0;
  const capitalOk = positionValue <= capital;
  const slVolOk = atr > 0 ? riskPerShare >= atr : true;
  const allOk = rrOk && riskSizeOk && capitalOk && slVolOk && quantity > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Overall verdict banner */}
      <div className={`rounded-xl p-3 flex items-center gap-2 ${allOk ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
        <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${PILL[allOk ? "GO" : "SKIP"]}`}>{allOk ? "GO" : "SKIP"}</span>
        <span className="text-xs text-slate-500">
          {allOk ? "All 4 checks pass — setup is planning-ready." : "One or more checks failed — see Verdict panel below."}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column: inputs */}
        <div className="flex flex-col gap-4">
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">1. Capital &amp; Risk</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500 col-span-2">
                <div className="mb-1">Total trading capital (₹)</div>
                <input type="number" step={10000} value={capital} onChange={(e) => setCapital(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Risk per trade (%)</div>
                <input type="number" step={0.1} value={riskPct} onChange={(e) => setRiskPct(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Direction</div>
                <select value={direction} onChange={(e) => setDirection(e.target.value as "long" | "short")} className={inputCls}>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </label>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">2. Trade Levels</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500">
                <div className="mb-1">Entry price (₹)</div>
                <input type="number" step={0.05} value={entry} onChange={(e) => setEntry(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">{isLong ? "Support zone (₹)" : "Resistance zone (₹)"}</div>
                <input type="number" step={0.05} value={zone} onChange={(e) => setZone(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">ATR (14) (₹)</div>
                <input type="number" step={0.05} value={atr} onChange={(e) => setAtr(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">ATR multiplier (SL buffer)</div>
                <input type="number" step={0.1} value={atrMult} onChange={(e) => setAtrMult(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Target 1 (₹)</div>
                <input type="number" step={0.05} value={target1} onChange={(e) => setTarget1(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Target 2 (₹)</div>
                <input type="number" step={0.05} value={target2} onChange={(e) => setTarget2(parseFloat(e.target.value) || 0)} className={inputCls} />
              </label>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">3. Stop Loss</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500">
                <div className="mb-1">Suggested SL</div>
                <div className={outCls}>₹{fmt(suggestedSL)}</div>
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1 flex items-center justify-between">
                  <span>SL actually used</span>
                  {slOverride.trim() !== "" && (
                    <button onClick={() => setSlOverride("")} className="text-blue-500 hover:text-blue-700 text-[10px]">reset</button>
                  )}
                </div>
                <input type="number" step={0.05} value={slOverride} placeholder={fmt(suggestedSL)}
                  onChange={(e) => setSlOverride(e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Risk per share (₹)</div>
                <div className={outCls}>₹{fmt(riskPerShare)}</div>
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">SL distance from entry (%)</div>
                <div className={outCls}>{fmt(slDistancePct, 1)}%</div>
              </label>
            </div>
          </section>
        </div>

        {/* Right column: outputs */}
        <div className="flex flex-col gap-4">
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">4. Position Size</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500 col-span-2">
                <div className="mb-1">Max risk amount (₹) = capital × risk%</div>
                <div className={outCls}>₹{fmt(maxRiskAmount, 0)}</div>
              </label>
              <label className="text-xs text-slate-500 col-span-2">
                <div className="mb-1">QUANTITY (shares)</div>
                <div className="w-full text-lg border border-emerald-200 bg-emerald-50 rounded px-2 py-1.5 font-bold text-emerald-700">{fmt(quantity, 0)}</div>
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Position value (₹)</div>
                <div className={outCls}>₹{fmt(positionValue, 0)}</div>
              </label>
              <label className="text-xs text-slate-500">
                <div className="mb-1">Position % of capital</div>
                <div className={outCls}>{fmt(positionPctOfCapital, 1)}%</div>
              </label>
              <label className="text-xs text-slate-500 col-span-2">
                <div className="mb-1">Actual risk if SL hits (₹)</div>
                <div className={outCls}>₹{fmt(actualRisk, 0)}</div>
              </label>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">5. Reward &amp; Risk:Reward</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500"><div className="mb-1">R:R at Target 1</div><div className={outCls}>{fmt(rrT1)}×</div></label>
              <label className="text-xs text-slate-500"><div className="mb-1">R:R at Target 2</div><div className={outCls}>{fmt(rrT2)}×</div></label>
              <label className="text-xs text-slate-500"><div className="mb-1">Profit at T1 (₹)</div><div className={outCls}>₹{fmt(profitT1, 0)}</div></label>
              <label className="text-xs text-slate-500"><div className="mb-1">Profit at T2 (₹)</div><div className={outCls}>₹{fmt(profitT2, 0)}</div></label>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">6. R-Multiple Price Ladder</div>
            <div className="grid grid-cols-4 gap-2">
              {ladder.map((price, i) => (
                <div key={i} className="text-center">
                  <div className="text-[10px] text-slate-400">{i + 1}R</div>
                  <div className="text-xs font-semibold text-slate-700">₹{fmt(price)}</div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 mt-2">Thumb rule: book 50% at 2R, move SL to breakeven.</div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">7. Verdict</div>
            <div className="flex flex-col gap-2 text-xs">
              {[
                { label: "R:R filter (min 1:2)", ok: rrOk, okMsg: "OK — R:R sufficient", badMsg: "REJECT — R:R kam hai" },
                { label: "Risk size check", ok: riskSizeOk, okMsg: "OK — risk control me", badMsg: "TOO HIGH — risk% zyada hai" },
                { label: "Capital check", ok: capitalOk, okMsg: "OK — capital ke andar", badMsg: "OVER — leverage, capital se zyada" },
                { label: "SL vs volatility", ok: slVolOk, okMsg: "OK — SL noise se bahar", badMsg: "TOO TIGHT — noise ke andar" },
              ].map((c) => (
                <div key={c.label} className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">{c.label}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PILL[c.ok ? "OK" : "REJECT"]}`}>{c.ok ? c.okMsg : c.badMsg}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
