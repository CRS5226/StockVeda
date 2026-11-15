import type { DistBin, DistCurvePoint } from "../../../lib/api";

export interface Marker { x: number; label: string; color: string; dashed?: boolean }

interface Props {
  bins: DistBin[];
  curve: DistCurvePoint[];
  markers?: Marker[];
  /** Text for the axis ticks and markers. */
  format: (x: number) => string;
  height?: number;
}

/** A histogram with a normal curve over it and labelled vertical markers (for example today's value or a loss level). */
export default function DistributionChart({ bins, curve, markers = [], format, height = 170 }: Props) {
  const w = 360, padL = 8, padR = 8, padB = 22;
  const padT = markers.length > 1 ? 28 : 16;               // room above the curve for the marker labels
  const lo = bins[0].x0, hi = bins[bins.length - 1].x1;
  const top = Math.max(...bins.map((b) => b.count), ...curve.map((c) => c.y), 1);
  const x = (v: number) => padL + ((v - lo) / (hi - lo)) * (w - padL - padR);
  const y = (c: number) => padT + (1 - c / top) * (height - padT - padB);
  const base = y(0);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="Distribution with a fitted normal curve">
      {bins.map((b) => <rect key={b.x0} x={x(b.x0) + 0.5} y={y(b.count)} width={Math.max(x(b.x1) - x(b.x0) - 1, 1)} height={Math.max(base - y(b.count), 0)} fill="#93c5fd" />)}
      <path d={curve.map((c, i) => `${i === 0 ? "M" : "L"}${x(c.x).toFixed(1)},${y(c.y).toFixed(1)}`).join(" ")} fill="none" stroke="#1d4ed8" strokeWidth="1.5" />
      <line x1={padL} x2={w - padR} y1={base} y2={base} stroke="#94a3b8" />
      {markers.map((m, i) => (
        <g key={m.label}>
          <line x1={x(m.x)} x2={x(m.x)} y1={padT - 6} y2={base} stroke={m.color} strokeDasharray={m.dashed ? "4 3" : undefined} strokeWidth="1.2" />
          <text x={x(m.x)} y={9 + (i % 2) * 10} fontSize="8" fill={m.color} textAnchor={x(m.x) > w - 60 ? "end" : x(m.x) < 60 ? "start" : "middle"}>{m.label}</text>
        </g>
      ))}
      {ticks.map((t, i) => <text key={i} x={x(t)} y={height - 6} fontSize="9" fill="#64748b" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{format(t)}</text>)}
    </svg>
  );
}
