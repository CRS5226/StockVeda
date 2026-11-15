import { compactRupees } from "../../../lib/signalInsights";
import type { SimulationResult } from "../../../lib/api";

/** The simulated value month by month: a band for the middle half of outcomes, a lighter one for 90%, the median, and a few single paths. */
export default function FanChart({ result }: { result: SimulationResult }) {
  const { bands, samples, months, start_value: start } = result;
  const w = 380, h = 190, padL = 38, padR = 26, padT = 12, padB = 20;       // drawn close to its on-screen width, so the text is not shrunk
  const all = [...bands.p5, ...bands.p95, start];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (k: number) => padL + (k / months) * (w - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (h - padT - padB);
  const line = (vs: number[]) => vs.map((v, k) => `${k === 0 ? "M" : "L"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = (top: number[], bottom: number[]) => `${line(top)} ${bottom.map((v, i) => `L${x(bottom.length - 1 - i).toFixed(1)},${y(bottom[bottom.length - 1 - i]).toFixed(1)}`).join(" ")} Z`;
  const yTicks = [lo, lo + span / 2, hi];
  const xTicks = Array.from({ length: months + 1 }, (_, k) => k).filter((k) => months <= 12 ? k % 3 === 0 : k % 6 === 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Monte Carlo fan chart of the portfolio value">
      {yTicks.map((t) => (
        <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" /><text x={padL - 4} y={y(t) + 3} fontSize="8" fill="#64748b" textAnchor="end">{compactRupees(t)}</text></g>
      ))}
      {xTicks.map((k) => <text key={k} x={x(k)} y={h - 5} fontSize="8" fill="#64748b" textAnchor={k === 0 ? "start" : k === months ? "end" : "middle"}>{k === 0 ? "Now" : `${k}M`}</text>)}
      {samples.slice(0, 12).map((s, i) => <path key={i} d={line(s)} fill="none" stroke="#94a3b8" strokeOpacity="0.35" strokeWidth="0.8" />)}
      <path d={area(bands.p95, bands.p5)} fill="#3b82f6" fillOpacity="0.12" />
      <path d={area(bands.p75, bands.p25)} fill="#3b82f6" fillOpacity="0.22" />
      <line x1={padL} x2={w - padR} y1={y(start)} y2={y(start)} stroke="#475569" strokeDasharray="4 3" />
      <path d={line(bands.p50)} fill="none" stroke="#1d4ed8" strokeWidth="2" />
      <text x={w - padR + 3} y={y(bands.p95[months]) + 3} fontSize="8" fill="#1d4ed8">95%</text>
      <text x={w - padR + 3} y={y(bands.p50[months]) + 3} fontSize="8" fill="#1d4ed8" fontWeight="600">50%</text>
      <text x={w - padR + 3} y={y(bands.p5[months]) + 3} fontSize="8" fill="#1d4ed8">5%</text>
    </svg>
  );
}
