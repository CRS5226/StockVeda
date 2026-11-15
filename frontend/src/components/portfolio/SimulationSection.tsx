import { useState } from "react";
import { pct, signedPct } from "../../lib/healthLabels";
import { usePortfolioSimulation } from "../../lib/usePortfolioSimulation";
import { compactRupees } from "../../lib/signalInsights";
import DistributionChart from "./charts/DistributionChart";
import FanChart from "./charts/FanChart";

const HORIZONS = [{ months: 3, label: "3M" }, { months: 6, label: "6M" }, { months: 12, label: "1Y" }, { months: 24, label: "2Y" }];

function Card({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2 min-w-0 ${className}`} title={hint}>
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{label}</div>
      <div className={`text-sm font-semibold tabular-nums truncate ${tone ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}

/**
 * Monte Carlo and distribution charts for the whole portfolio. The stocks and funds are resampled from their own past
 * returns; FDs grow by their terms; assets with no price history are held at today's value. A picture of what the past
 * would imply, not a forecast.
 */
export default function SimulationSection({ portfolioId, refreshKey }: { portfolioId: number; refreshKey: number }) {
  const [months, setMonths] = useState(12);
  const sim = usePortfolioSimulation(portfolioId, months, refreshKey);
  const r = sim.report?.result ?? null;
  const c = sim.report?.composition;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="font-semibold">Simulation</h3>
        <span className="text-[11px] text-slate-500">Resampled from the past returns of your stocks and funds. Not a forecast.</span>
        <div className="ml-auto flex gap-1 text-xs font-medium" role="group" aria-label="Horizon">
          {HORIZONS.map((h) => (
            <button key={h.months} onClick={() => setMonths(h.months)} aria-pressed={months === h.months}
              className={`px-2.5 py-1 rounded-full border ${months === h.months ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{h.label}</button>
          ))}
        </div>
      </div>
      {sim.error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{sim.error}</div>}
      {!sim.report ? <div className="py-8 text-center text-sm text-slate-400">{sim.loading ? "Running the simulation…" : ""}</div> : !r ? (
        <div className="py-8 text-center text-sm text-slate-400">Not enough price history stored yet ({sim.report.min_days} days of returns are needed). Press Sync prices, then Load price history on the Signals tab.</div>
      ) : (
        <div className={`flex flex-col gap-3 ${sim.loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Tile label="Today" value={compactRupees(r.start_value)} />
            <Tile label={`Median ${months >= 12 ? `${months / 12}Y` : `${months}M`}`} value={compactRupees(r.outcome.median)} />
            <Tile label="Bad case 5%" value={compactRupees(r.outcome.p5)} tone="text-red-600" />
            <Tile label="Good case 95%" value={compactRupees(r.outcome.p95)} tone="text-emerald-600" />
            <Tile label="Below today" value={pct(r.outcome.chance_below_start_pct, 0)} tone={r.outcome.chance_below_start_pct > 50 ? "text-amber-600" : undefined} />
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            <Card title="Fan chart" className="lg:col-span-3" hint="Median, middle 50% and middle 90% of 2,000 simulated paths, with a few single paths"><FanChart result={r} /></Card>
            <Card title="Where it ends" className="lg:col-span-2" hint="How many simulated paths end at each value, with a normal curve fitted to them">
              <DistributionChart bins={r.outcome.bins} curve={r.outcome.curve} format={compactRupees}
                markers={[{ x: r.start_value, label: "Today", color: "#475569", dashed: true }, { x: r.outcome.p5, label: "5%", color: "#dc2626" }, { x: r.outcome.p95, label: "95%", color: "#059669" }]} />
              <div className="text-[10px] text-slate-500">Bars: simulated outcomes · curve: normal fit · average of the worst 5%: {compactRupees(r.outcome.average_of_worst_5pct)}</div>
            </Card>
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            <Card title="Daily returns vs normal" className="lg:col-span-3" hint="Each bar is how many past days had that return; the curve is a normal distribution with the same average and spread">
              <DistributionChart bins={r.returns.bins} curve={r.returns.curve} format={(v) => `${v.toFixed(1)}%`}
                markers={[{ x: r.returns.var95_pct, label: "worst 5%", color: "#dc2626", dashed: true }, { x: r.returns.var95_normal_pct, label: "normal says", color: "#1d4ed8", dashed: true }]} />
              <div className="text-[10px] text-slate-500">Bars: {r.returns.days} past days of your stocks and funds · curve: normal fit</div>
            </Card>
            <Card title="Tails" className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-2">
                <Tile label="Yearly swing" value={pct(r.returns.annual_vol_pct, 0)} />
                <Tile label="Worst day" value={signedPct(r.returns.worst_day_pct)} tone="text-red-600" />
                <Tile label="Bad 1-in-20 day" value={signedPct(r.returns.var95_pct)} />
                <Tile label="Normal says" value={signedPct(r.returns.var95_normal_pct)} />
                <Tile label="Tail shape" value={r.returns.excess_kurtosis > 1 ? "Fat tails" : r.returns.excess_kurtosis < -1 ? "Thin tails" : "Near normal"} tone={r.returns.excess_kurtosis > 1 ? "text-amber-600" : undefined} />
                <Tile label="Days beyond 3σ" value={`${r.returns.days_beyond_3_sigma} (normal ${r.returns.expected_beyond_3_sigma.toFixed(1)})`} />
              </div>
            </Card>
          </div>
          {c && (
            <p className="text-[11px] text-slate-500">
              Simulated: stocks {compactRupees(c.stocks)}{c.funds > 0 && ` and funds ${compactRupees(c.funds)}`}. Grown by their terms: FDs {compactRupees(c.fixed_deposits)}.
              {c.held_flat > 0 && ` Held at today's value (no price history stored): ${sim.report.held_flat.map((a) => a.name.replace(/ \(sample\)/, "")).join(", ")}, ${compactRupees(c.held_flat)}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
