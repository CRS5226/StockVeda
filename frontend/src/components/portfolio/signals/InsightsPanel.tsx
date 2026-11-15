import type { SignalsReport } from "../../../lib/api";
import { buildInsights, highDistance, leanSplit, profitSpread, trendSplit } from "../../../lib/signalInsights";
import DonutChart from "../charts/DonutChart";
import Histogram from "../charts/Histogram";
import StackedBar from "../charts/StackedBar";

const TONE = { good: "border-emerald-200 bg-emerald-50 text-emerald-800", watch: "border-amber-200 bg-amber-50 text-amber-800", info: "border-slate-200 bg-white text-slate-700" } as const;

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
      <div>
        <h4 className="font-semibold text-sm">{title}</h4>
        {note && <p className="text-[11px] text-slate-500">{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** What stands out, in a few sentences and four small charts. Everything counts stocks only. */
export default function InsightsPanel({ report }: { report: SignalsReport }) {
  const { rows, summary: s } = report;
  const insights = buildInsights(report);
  const trend = trendSplit(rows);
  return (
    <div className="flex flex-col gap-4">
      {insights.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {insights.map((i) => <li key={i.text} className={`text-sm border rounded-lg px-3 py-2 ${TONE[i.tone]}`}>{i.text}</li>)}
        </ul>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Against the 200-day average" note="Latest daily close compared with its 200-day average">
          <DonutChart slices={trend} center={`${s.below_sma200}`} sub={`of ${s.with_sma200} below`} />
        </Card>
        <Card title="What the daily rules lean towards" note="EMA, MACD, RSI, Bollinger and breakout rules that count today">
          <StackedBar slices={leanSplit(rows)} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-emerald-50 text-emerald-700 px-2.5 py-2"><b className="text-base tabular-nums">{s.aligned_bullish}</b><br />bullish on all timeframes</div>
            <div className="rounded-lg bg-red-50 text-red-700 px-2.5 py-2"><b className="text-base tabular-nums">{s.aligned_bearish}</b><br />bearish on all timeframes</div>
          </div>
        </Card>
        <Card title="Distance from the 52-week high" note="How far below the year's highest close each stock is">
          <Histogram bins={highDistance(rows)} />
        </Card>
        <Card title="Profit and loss of your positions" note="Number of stocks in each range">
          <Histogram bins={profitSpread(rows)} />
        </Card>
      </div>
    </div>
  );
}
