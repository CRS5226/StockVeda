import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PortfolioDividend } from "../../lib/api";
import { groupByDate, isoDay, monthGrid } from "../../lib/calendar";
import { rupees } from "../../lib/formatMoney";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Props {
  year: number;
  month: number;                         // 0 to 11
  dividends: PortfolioDividend[];
  selected: string | null;               // "YYYY-MM-DD"
  onSelect: (date: string) => void;
  onMonth: (delta: number) => void;
  /** Jump straight to a month and year picked from the dropdowns. */
  onJump: (year: number, month: number) => void;
  onToday: () => void;
}

/** A month calendar. A day with a dividend is green and shows the amount; click a day to see who paid it. */
export default function DividendCalendar({ year, month, dividends, selected, onSelect, onMonth, onJump, onToday }: Props) {
  const byDate = groupByDate(dividends);
  const now = new Date();
  const today = isoDay(now.getFullYear(), now.getMonth(), now.getDate());
  const monthRows = dividends.filter((d) => d.pay_date.startsWith(isoDay(year, month, 1).slice(0, 7)));
  const monthTotal = monthRows.reduce((sum, d) => sum + d.amount, 0);
  const nav = "p-1.5 rounded-lg text-slate-500 hover:bg-slate-100";
  // years from five back (or the earliest dividend, if older) to next year, and always the one on screen
  const thisYear = now.getFullYear();
  const earliest = dividends.reduce((min, d) => Math.min(min, Number(d.pay_date.slice(0, 4))), thisYear - 5);
  const years = Array.from({ length: thisYear + 1 - Math.min(earliest, year) + 1 }, (_, i) => Math.min(earliest, year) + i).reverse();
  const picker = "px-2 py-1 text-sm font-semibold border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:outline-none focus:border-blue-400";

  return (
    <div className="flex-1 min-w-[300px]">
      <div className="flex items-center gap-2 mb-3">
        <button className={nav} onClick={() => onMonth(-1)} title="Previous month"><ChevronLeft size={16} /></button>
        <select className={picker} value={month} onChange={(e) => onJump(year, Number(e.target.value))} aria-label="Month">
          {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <select className={picker} value={year} onChange={(e) => onJump(Number(e.target.value), month)} aria-label="Year">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className={nav} onClick={() => onMonth(1)} title="Next month"><ChevronRight size={16} /></button>
        <button onClick={onToday} className="px-2 py-1 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Today</button>
        <span className="ml-auto text-xs text-slate-500 tabular-nums">
          {monthRows.length > 0 ? `${rupees(monthTotal)} from ${monthRows.length} ${monthRows.length === 1 ? "payment" : "payments"}` : "No dividends this month"}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400 mb-1">
        {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthGrid(year, month).flat().map((c) => {
          const paid = byDate.get(c.date);
          const total = paid?.reduce((sum, d) => sum + d.amount, 0) ?? 0;
          const isSelected = c.date === selected;
          return (
            <button key={c.date} onClick={() => onSelect(c.date)}
              title={paid ? paid.map((d) => `${d.symbol}: ${rupees(d.amount)}`).join("\n") : undefined}
              className={`h-16 rounded-lg border p-1.5 text-left flex flex-col transition-colors ${
                paid ? "bg-emerald-50 border-emerald-300 hover:bg-emerald-100" : "bg-white border-slate-100 hover:bg-slate-50"
              } ${isSelected ? "ring-2 ring-blue-500" : ""} ${c.inMonth ? "" : "opacity-40"}`}>
              <span className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
                c.date === today ? "bg-blue-600 text-white" : paid ? "text-emerald-800" : "text-slate-600"}`}>{c.day}</span>
              {paid && (
                <span className="mt-auto leading-tight">
                  <span className="block text-[11px] font-semibold text-emerald-700 tabular-nums">{rupees(total).replace(".00", "")}</span>
                  <span className="block text-[10px] text-emerald-600 truncate">{paid.length === 1 ? paid[0].symbol : `${paid[0].symbol} +${paid.length - 1}`}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-300" /> Dividend received</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-600" /> Today</span>
      </div>
    </div>
  );
}
