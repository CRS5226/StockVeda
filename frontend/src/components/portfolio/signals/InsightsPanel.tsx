import type { SignalsReport } from "../../../lib/api";
import { compactRupees, highDistance, leanSplit, profitSpread, trendSplit } from "../../../lib/signalInsights";
import Contributors from "../charts/Contributors";
import DonutChart from "../charts/DonutChart";
import HeatMap from "../charts/HeatMap";
import Histogram from "../charts/Histogram";
import SectorBars from "../charts/SectorBars";
import StackedBar from "../charts/StackedBar";
import TrendMap from "../charts/TrendMap";

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 min-w-0" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{label}</div>
      <div className={`text-base font-semibold tabular-nums truncate ${tone ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function Card({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2 min-w-0 ${className}`} title={hint}>
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

/** The picture of the stock holdings: key numbers, a heat map, gains and losses, the trend map, sectors and a few spreads. */
export default function InsightsPanel({ report }: { report: SignalsReport }) {
  const { rows, summary: s } = report;
  const gain = rows.reduce((a, r) => a + r.gain, 0);
  const invested = rows.reduce((a, r) => a + r.value - r.gain, 0);
  const up = (n: number) => (n >= 0 ? "text-emerald-600" : "text-red-600");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile label="Stocks" value={String(s.stocks)} />
        <Tile label="Value" value={compactRupees(report.stock_value)} />
        <Tile label="Gain / loss" value={`${gain >= 0 ? "+" : ""}${compactRupees(gain)}`} tone={up(gain)} hint={invested ? `${((gain / invested) * 100).toFixed(1)}% on ${compactRupees(invested)} invested` : undefined} />
        <Tile label="Below 200D" value={`${s.below_sma200}/${s.with_sma200}`} tone={s.below_sma200 > s.with_sma200 / 2 ? "text-amber-600" : undefined} hint="Stocks below their 200-day average" />
        <Tile label="Deep drop" value={String(s.deep_drawdown)} tone={s.deep_drawdown ? "text-red-600" : undefined} hint="25% or more below the 52-week high" />
        <Tile label="Over limit" value={String(s.over_limit)} tone={s.over_limit ? "text-amber-600" : undefined} hint={`Above your ${report.concentration.max_pct}% size limit`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Heat map" className="lg:col-span-2" hint="Tile size is the share of your stock holdings; colour is the profit or loss"><HeatMap rows={rows} /></Card>
        <Card title="Biggest gains and losses"><Contributors rows={rows} /></Card>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Trend map" hint="Right of the dashed line is above the 200-day average; higher is nearer the 52-week high"><TrendMap rows={rows} /></Card>
        <Card title="Sectors" hint="Share of the stock holdings by sector"><SectorBars rows={rows} /></Card>
      </div>
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <Card title="200-day trend"><DonutChart size={96} slices={trendSplit(rows).map((x) => ({ ...x, label: x.label.replace(" 200-day average", " 200D").replace("Not enough candles", "No data") }))} center={String(s.below_sma200)} sub="below" /></Card>
        <Card title="Daily lean">
          <StackedBar slices={leanSplit(rows).map((x) => ({ ...x, label: x.label === "Bullish" ? "Bull" : x.label === "Bearish" ? "Bear" : x.label }))} />
          <div className="flex gap-2 text-[10px] font-semibold">
            <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700" title="Bullish on weekly, daily and 1-hour">▲ {s.aligned_bullish} aligned</span>
            <span className="px-2 py-1 rounded bg-red-50 text-red-700" title="Bearish on weekly, daily and 1-hour">▼ {s.aligned_bearish} aligned</span>
          </div>
        </Card>
        <Card title="Gap to 52-week high"><Histogram bins={highDistance(rows)} height={64} /></Card>
        <Card title="Profit spread"><Histogram bins={profitSpread(rows)} height={64} /></Card>
      </div>
    </div>
  );
}
