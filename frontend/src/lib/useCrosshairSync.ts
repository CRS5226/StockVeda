import { useCallback, useEffect, useRef } from "react";
import type { MouseEventParams } from "lightweight-charts";
import type { ChartHandle } from "../components/BacktestChart";
import { barKey, toChartTime } from "./barTime";
import { barAtOrBefore, chartTimeToEpoch } from "./crosshairSync";

interface PaneBars { epochs: number[]; closes: number[]; times: ReturnType<typeof toChartTime>[] }

/**
 * Mirrors the crosshair of one of two charts onto the other, matching by time (the bar the time falls in),
 * so a 5-minute and a 1-minute chart point at the same moment.
 */
export function useCrosshairSync() {
  const handles = useRef<(ChartHandle | null)[]>([null, null]);
  const data = useRef<(PaneBars | null)[]>([null, null]);
  const unsubs = useRef<(() => void)[]>([() => {}, () => {}]);
  const mirroring = useRef(false);

  const attach = useCallback((from: 0 | 1) => {
    unsubs.current[from]();
    unsubs.current[from] = () => {};
    const source = handles.current[from];
    if (!source) return;
    const to = (1 - from) as 0 | 1;
    const onMove = (p: MouseEventParams) => {
      if (mirroring.current) return;
      const target = handles.current[to], bars = data.current[to];
      if (!target) return;
      mirroring.current = true;
      try {
        const epoch = p.time === undefined ? null : chartTimeToEpoch(p.time);
        const i = epoch === null || !bars ? -1 : barAtOrBefore(bars.epochs, epoch);
        if (i < 0 || !bars) target.chart.clearCrosshairPosition();
        else target.chart.setCrosshairPosition(bars.closes[i], bars.times[i], target.series);
      } finally {
        mirroring.current = false;
      }
    };
    source.chart.subscribeCrosshairMove(onMove);
    unsubs.current[from] = () => { try { source.chart.unsubscribeCrosshairMove(onMove); } catch { /* chart already gone */ } };
  }, []);

  useEffect(() => () => unsubs.current.forEach((u) => u()), []);

  /** Pane `index` has a chart (or lost it). */
  const register = useCallback((index: 0 | 1, handle: ChartHandle | null) => {
    handles.current[index] = handle;
    attach(index);
  }, [attach]);

  /** Pane `index` now shows these bars. */
  const setBars = useCallback((index: 0 | 1, bars: { date: string; close: number }[]) => {
    const keys = bars.map((b) => barKey(b.date));
    const times = keys.map(toChartTime);
    data.current[index] = { epochs: times.map((t) => chartTimeToEpoch(t) ?? 0), closes: bars.map((b) => b.close), times };
  }, []);

  return { register, setBars };
}
