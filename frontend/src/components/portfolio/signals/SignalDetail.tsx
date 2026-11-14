import type { SignalFrame, SignalRow, SignalTimeframe } from "../../../lib/api";
import { pct, signedPct } from "../../../lib/healthLabels";
import { REGIME_LABEL, STATE_ARROW, STATE_LABEL, STATE_STYLE } from "../../../lib/signalLabels";
import { rupees } from "../../../lib/formatMoney";

const TF_NAME: Record<SignalTimeframe, string> = { "1W": "Weekly candles", "1D": "Daily candles", "1H": "1-hour candles" };

function Frame({ tf, frame }: { tf: SignalTimeframe; frame: SignalFrame | null }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium text-sm">{TF_NAME[tf]}</span>
        {frame && <span className="ml-auto text-[11px] text-slate-500">{frame.regime ? REGIME_LABEL[frame.regime] : "—"}{frame.adx !== null && ` · ADX ${frame.adx.toFixed(0)}`}</span>}
      </div>
      {!frame ? <div className="text-xs text-slate-400">Not enough candles stored.</div> : (
        <ul className="flex flex-col gap-1.5">
          {frame.rules.map((r) => (
            <li key={r.key} className={`flex items-start gap-2 text-xs ${r.counts ? "" : "opacity-50"}`} title={r.counts ? undefined : "Not counted in this market regime"}>
              <span className={`shrink-0 w-16 text-center font-semibold px-1.5 py-0.5 rounded ${STATE_STYLE[r.state]}`}>{STATE_ARROW[r.state]} {STATE_LABEL[r.state]}</span>
              <span className="text-slate-600"><span className="font-medium text-slate-800">{r.label}</span>: {r.detail}
                {r.since && <span className="text-slate-400"> · since {r.since}{r.fresh ? " (recent)" : ""}</span>}
                {!r.counts && !r.detail.startsWith("Needs") && <span className="text-slate-400"> · not counted</span>}
              </span>
            </li>
          ))}
          <li className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            {frame.votes.bullish} bullish, {frame.votes.bearish} bearish, {frame.votes.neutral} neutral of {frame.votes.counted} counted rules · latest candle {frame.as_of.slice(0, 16)}
          </li>
        </ul>
      )}
    </div>
  );
}

/** Everything behind one row: each rule on each timeframe, the zone conditions, and the share arithmetic. */
export default function SignalDetail({ row, maxPct }: { row: SignalRow; maxPct: number }) {
  const z = row.sizing;
  return (
    <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {(["1W", "1D", "1H"] as SignalTimeframe[]).map((tf) => <Frame key={tf} tf={tf} frame={row.timeframes[tf]} />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="border border-slate-200 bg-white rounded-lg p-3">
          <div className="font-medium text-sm mb-2">Zone conditions</div>
          {row.zone_checks.length === 0 ? <div className="text-xs text-slate-400">No daily rules to check yet.</div> : (
            <ul className="flex flex-col gap-1 text-xs">
              {row.zone_checks.map((c) => <li key={c.text} className={c.met ? "text-emerald-700" : "text-slate-500"}>{c.met ? "✓" : "✗"} {c.text}</li>)}
            </ul>
          )}
        </div>
        <div className="border border-slate-200 bg-white rounded-lg p-3 text-xs flex flex-col gap-1.5">
          <div className="font-medium text-sm mb-1">If you sold part ({row.qty} shares at {rupees(row.last)})</div>
          <div>Selling {z.trim.pct}% is <b>{z.trim.shares}</b> {z.trim.shares === 1 ? "share" : "shares"}, about {rupees(z.trim.value)}.</div>
          <div>{z.cost_out.possible
            ? <>Selling <b>{z.cost_out.shares}</b> {z.cost_out.shares === 1 ? "share" : "shares"} ({rupees(z.cost_out.value)}) returns the money you put in.</>
            : "The position is worth less than you put in, so selling cannot return all of it."}</div>
          <div className="text-slate-400">Average buy price {rupees(row.avg_price)}; profit {signedPct(row.pnl_pct, 0)}.</div>
        </div>
        <div className="border border-slate-200 bg-white rounded-lg p-3 text-xs flex flex-col gap-1.5">
          <div className="font-medium text-sm mb-1">If you added {rupees(z.add.budget)}</div>
          {z.add.shares === 0 ? (
            <div>{z.add.limited_by_size ? `The position is at your ${pct(maxPct, 0)} size limit, so there is no room to add.` : "Less than one share."}</div>
          ) : (
            <>
              <div><b>{z.add.shares}</b> {z.add.shares === 1 ? "share" : "shares"} for about {rupees(z.add.value)}{z.add.limited_by_size ? `, held down by your ${pct(maxPct, 0)} size limit` : ""}.</div>
              <div>Average buy price {rupees(z.add.avg_before)} → <b>{rupees(z.add.avg_after)}</b>.</div>
              <div>Price must rise {signedPct(z.add.breakeven_before_pct)} to reach the average now, {signedPct(z.add.breakeven_after_pct)} after.</div>
            </>
          )}
          <div className="text-slate-400">Adding to a falling stock can deepen a loss; this is arithmetic, not a view.</div>
        </div>
      </div>
    </div>
  );
}
