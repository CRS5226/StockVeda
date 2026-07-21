import { useState } from "react";

const PILL: Record<string, string> = {
  GO: "bg-emerald-600 text-white",
  SKIP: "bg-red-600 text-white",
  PENDING: "bg-slate-300 text-slate-600",
};

const ITEMS = [
  "Higher-timeframe trend aligned with my trade direction?",
  "Entry is at a valid technical level (support/resistance/breakout), not mid-range?",
  "Volume/liquidity adequate — no illiquidity risk?",
  "No major news/earnings/event risk before I can realistically exit?",
  "Market/sector regime supportive (not fighting a broad opposing trend)?",
  "Trade Calculator verdict is GO (R:R, risk size, capital, SL-vs-volatility all pass)?",
  "Position size (quantity) is calculated, not guessed?",
  "I'm mentally prepared to honor the stop-loss without moving it?",
];

export default function PlannerChecklistTab() {
  const [answers, setAnswers] = useState<Record<number, boolean | null>>(
    Object.fromEntries(ITEMS.map((_, i) => [i, null]))
  );

  const answeredCount = Object.values(answers).filter((v) => v !== null).length;
  const allYes = Object.values(answers).every((v) => v === true);
  const anyNo = Object.values(answers).some((v) => v === false);
  const verdict = anyNo ? "SKIP" : allYes ? "GO" : "PENDING";

  const reset = () => setAnswers(Object.fromEntries(ITEMS.map((_, i) => [i, null])));

  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-xl p-3 flex items-center justify-between gap-2 ${
        verdict === "GO" ? "bg-emerald-50 border border-emerald-200" :
        verdict === "SKIP" ? "bg-red-50 border border-red-200" : "bg-slate-50 border border-slate-200"}`}>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${PILL[verdict]}`}>{verdict}</span>
          <span className="text-xs text-slate-500">
            {verdict === "GO" ? "All 8 checks pass — cleared to trade." :
             verdict === "SKIP" ? "At least one item is NO — do not take this trade." :
             `${answeredCount}/8 answered`}
          </span>
        </div>
        <button onClick={reset} className="text-[10px] text-slate-400 hover:text-slate-600">Reset</button>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="text-xs font-semibold text-slate-500 mb-3">8-point pre-trade checklist</div>
        <div className="flex flex-col divide-y divide-slate-50">
          {ITEMS.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-slate-600 flex-1">{i + 1}. {item}</span>
              <div className="flex gap-1 shrink-0">
                {(["YES", "NO"] as const).map((opt) => {
                  const val = opt === "YES";
                  const active = answers[i] === val;
                  return (
                    <button key={opt} onClick={() => setAnswers((a) => ({ ...a, [i]: val }))}
                      className={`px-2.5 py-1 rounded text-[10px] font-semibold border transition-colors ${
                        active
                          ? (val ? "bg-emerald-500 text-white border-emerald-500" : "bg-red-500 text-white border-red-500")
                          : "border-slate-200 text-slate-400 hover:border-slate-300"
                      }`}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="text-[10px] text-slate-400">
        This is a planning tool, not investment advice. Checklist answers are session-only and are not saved.
      </div>
    </div>
  );
}
