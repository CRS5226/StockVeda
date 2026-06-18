import { useEffect, useRef } from "react";
import { createChart, type IChartApi, ColorType } from "lightweight-charts";
import type { Time } from "lightweight-charts";

interface Series {
  label: string;
  color: string;
  data: { date: string; value: number }[];
}

interface Props {
  series: Series[];
  height?: number;
  title?: string;
}

const COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#a78bfa", "#f87171", "#fb923c"];

export default function MacroLineChart({ series, height = 220, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || !series.length) return;
    if (chart.current) { chart.current.remove(); chart.current = null; }

    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#0a0a0f" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: { borderColor: "#1f2937", timeVisible: true },
      width: ref.current.clientWidth,
      height,
    });
    chart.current = c;

    series.forEach((s, i) => {
      const line = c.addLineSeries({
        color: s.color || COLORS[i % COLORS.length],
        lineWidth: 2,
        title: s.label,
      });
      line.setData(
        s.data
          .filter((d) => d.value != null)
          .map((d) => ({ time: d.date as unknown as Time, value: d.value }))
      );
    });

    c.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) c.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); c.remove(); chart.current = null; };
  }, [series, height]);

  return (
    <div>
      {title && <div className="text-xs text-gray-400 font-medium px-1 pb-1">{title}</div>}
      <div ref={ref} className="w-full" />
    </div>
  );
}
