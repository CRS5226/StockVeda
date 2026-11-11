import { amountAt, evaluateTrade, summarize, type Amount, type ExitReason, type Instrument, type PaperTrade, type Position } from "../lib/paperTrading";
import { money, percent, points, price, signed, tone } from "../lib/formatTrade";

interface Bar { date: string; open: number; high: number; low: number; close: number }

interface Props {
  trades: PaperTrade[];
  bars: Bar[];
  cursor: number;
  dark: boolean;
  /** What is open on each instrument right now. */
  positions: Record<Instrument, Position | null>;
  onClose: (id: number) => void;
  /** Close everything that is open, on both instruments. */
  onCloseAll: () => void;
}

const REASON: Record<ExitReason, string> = { target: "Target hit", stoploss: "Stoploss hit", manual: "Closed" };
const shortDate = (d: string) => d.replace("T", " ").slice(0, 16).replace(/ 00:00$/, "");
/** Month-day and time for intraday bars, the plain date for daily ones. */
const stamp = (d: string) => {
  const t = d.replace("T", " ");
  return t.length > 10 && !t.slice(11, 16).startsWith("00:00") ? `${t.slice(5, 10)} ${t.slice(11, 16)}` : t.slice(0, 10);
};

/** Trades placed in the replay, newest first, with target / stop-loss / booked result in points, percent and money. */
export default function TradePanel({ trades, bars, cursor, dark, positions, onClose, onCloseAll }: Props) {
  const sum = summarize(trades, bars, cursor);
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const strong = dark ? "text-slate-100" : "text-slate-800";
  const card = dark ? "border-[#2a2e39] bg-[#1e222d]" : "border-slate-200 bg-slate-50";
  const rule = dark ? "border-[#2a2e39]" : "border-slate-200";
  const mark = bars[cursor]?.close;

  const line = (a: Amount) => (
    <span className={`tabular-nums ${tone(a.money, dark)}`}>{points(a.points)} · {percent(a.pct)} · {money(a.money)}</span>
  );

  const visible = trades.filter((t) => t.entryIndex <= cursor).slice().reverse();

  return (
    <div className={`h-full flex flex-col text-xs ${dark ? "bg-[#131722] text-slate-300" : "bg-white text-slate-700"}`}>
      <div className={`px-3 py-2 border-b ${rule}`}>
        <div className="flex items-center justify-between">
          <div className={`font-semibold text-sm ${strong}`}>Paper trades</div>
          <button onClick={onCloseAll} disabled={!positions.CE && !positions.PE} title="Close everything that is open at market"
            className={`px-2 py-1 rounded border text-[11px] font-semibold disabled:opacity-30 disabled:cursor-not-allowed ${
              dark ? "border-[#2a2e39] text-slate-200 hover:bg-[#2a2e39]" : "border-slate-300 text-slate-700 hover:bg-slate-100"
            }`}>
            Close all
          </button>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span className={muted}>Booked</span>
          <span className={`text-right tabular-nums font-semibold ${tone(sum.booked.money, dark)}`}>{money(sum.booked.money)}</span>
          <span className={muted}>Open P&amp;L</span>
          <span className={`text-right tabular-nums ${tone(sum.floating.money, dark)}`}>{money(sum.floating.money)}</span>
          <span className={muted}>Trades</span>
          <span className="text-right tabular-nums">{sum.total} ({sum.open} open)</span>
          <span className={muted}>Win rate</span>
          <span className="text-right tabular-nums">{sum.winRate === null ? "-" : `${sum.winRate.toFixed(0)}%`}</span>
        </div>
        <div className={`mt-2 pt-2 border-t grid grid-cols-2 gap-x-3 gap-y-0.5 ${rule}`}>
          {(["CE", "PE"] as const).map((ins) => {
            const p = positions[ins];
            return (
              <div key={ins} className="contents">
                <span className={muted}>{ins} position</span>
                <span className={`text-right tabular-nums ${p ? strong : muted}`}>
                  {p ? `${p.qty} ${p.side === "buy" ? "bought" : "sold"} @ ${price(p.avgPrice)}` : "none"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {visible.length === 0 && (
          <div className={`px-2 py-6 text-center ${muted}`}>No trades yet. Use Buy or Sell on the CE or PE card under the chart.</div>
        )}
        {visible.map((t) => {
          const s = evaluateTrade(t, bars, cursor);
          const buySide = t.side === "buy";
          const basis = s.status === "open" ? s.openQty : t.qty; // levels are shown for what is still open
          const target = s.target === null ? null : amountAt(t, s.target, basis);
          const stop = s.stopLoss === null ? null : amountAt(t, s.stopLoss, basis);
          const exitWord = buySide ? "Sold" : "Bought";
          const partly = s.status === "open" && s.exits.length > 0;
          return (
            <div key={t.id} className={`rounded border p-2 space-y-1 ${card}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`font-semibold ${buySide ? "text-emerald-500" : "text-red-500"}`}>
                  {buySide ? "BUY" : "SELL"} {t.instrument} {t.qty} @ {price(t.entryPrice)}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  s.status === "open" ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
                    : s.exitReason === "target" ? (dark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-50 text-emerald-600")
                    : s.exitReason === "stoploss" ? (dark ? "bg-red-500/20 text-red-400" : "bg-red-50 text-red-600")
                    : (dark ? "bg-slate-500/20 text-slate-300" : "bg-slate-100 text-slate-600")
                }`}>
                  {s.status === "open" ? (partly ? `Open ${s.openQty} of ${t.qty}` : "Open") : s.exitReason ? REASON[s.exitReason] : ""}
                </span>
              </div>
              <div className={muted}>Entered {shortDate(bars[t.entryIndex].date)}</div>
              <div>
                <span className={muted}>Target </span>
                {target && s.target !== null ? <>{price(s.target)} {line(target)}</> : <span className={muted}>none</span>}
              </div>
              <div>
                <span className={muted}>{s.trail !== null ? "Trailing stop " : "Stoploss "}</span>
                {stop && s.stopLoss !== null ? <>{price(s.stopLoss)} {line(stop)}</> : <span className={muted}>none</span>}
              </div>

              {s.exits.length > 0 && (
                <div className={`pt-1 border-t ${rule}`}>
                  <table className="w-full text-[11px] tabular-nums">
                    <thead>
                      <tr className={muted}>
                        <th className="text-left font-medium">{exitWord} at</th>
                        <th className="text-right font-medium">Qty</th>
                        <th className="text-right font-medium">Price</th>
                        <th className="text-right font-medium">Pts</th>
                        <th className="text-right font-medium">%</th>
                        <th className="text-right font-medium">&#8377;</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.exits.map((e, i) => {
                        const a = amountAt(t, e.price, e.qty);
                        return (
                          <tr key={i}>
                            <td className="text-left whitespace-nowrap">
                              {stamp(bars[e.index].date)}
                              {e.reason !== "manual" && (
                                <span className={`ml-1 font-semibold ${e.reason === "target" ? "text-emerald-500" : "text-red-500"}`}>
                                  {e.reason === "target" ? "TP" : "SL"}
                                </span>
                              )}
                            </td>
                            <td className="text-right">{e.qty}</td>
                            <td className="text-right">{price(e.price)}</td>
                            <td className={`text-right ${tone(a.money, dark)}`}>{signed(a.points)}</td>
                            <td className={`text-right ${tone(a.money, dark)}`}>{percent(a.pct)}</td>
                            <td className={`text-right ${tone(a.money, dark)}`}>{money(a.money).replace("\u20B9", "")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {s.exits.length > 1 && (
                      <tfoot>
                        <tr className={`border-t font-semibold ${rule}`}>
                          <td className={`text-left ${strong}`}>Booked</td>
                          <td className="text-right">{s.exits.reduce((n, e) => n + e.qty, 0)}</td>
                          <td />
                          <td className={`text-right ${tone(s.booked.money, dark)}`}>{signed(s.booked.points)}</td>
                          <td className={`text-right ${tone(s.booked.money, dark)}`}>{percent(s.booked.pct)}</td>
                          <td className={`text-right ${tone(s.booked.money, dark)}`}>{money(s.booked.money).replace("\u20B9", "")}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {s.status === "open" && mark !== undefined && (
                <div className={`pt-1 border-t ${rule}`}>
                  <span className={muted}>Now {price(mark)} on {s.openQty} open </span>
                  {line(amountAt(t, mark, s.openQty))}
                </div>
              )}
              {s.status === "open" && (
                <button onClick={() => onClose(t.id)}
                  className={`mt-1 px-2 py-1 rounded border text-[11px] font-semibold ${
                    dark ? "border-[#2a2e39] text-slate-200 hover:bg-[#2a2e39]" : "border-slate-300 text-slate-700 hover:bg-slate-100"
                  }`}>
                  Close remaining {s.openQty} at market
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
