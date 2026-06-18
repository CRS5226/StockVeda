import { BacktestResult } from "../lib/api";
import MacroLineChart from "./MacroLineChart";

interface Props { results: BacktestResult }

function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color = positive === undefined ? "text-gray-100"
    : positive ? "text-green-400" : "text-red-400";
  return (
    <div className="bg-gray-800 rounded p-3 flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}

export default function BacktestResults({ results }: Props) {
  const { stats, equity_curve, trades } = results;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Total Return" value={`${stats.total_return_pct.toFixed(2)}%`} positive={stats.total_return_pct >= 0} />
        <StatCard label="Win Rate" value={`${stats.win_rate_pct.toFixed(1)}%`} positive={stats.win_rate_pct >= 50} />
        <StatCard label="Max Drawdown" value={`${stats.max_drawdown_pct.toFixed(2)}%`} positive={false} />
        <StatCard label="Total Trades" value={String(stats.total_trades)} />
        <StatCard label="Final Value" value={`₹${stats.final_value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} positive={stats.final_value >= stats.initial_capital} />
        <StatCard label="Avg PnL/Trade" value={`₹${stats.avg_pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} positive={stats.avg_pnl >= 0} />
        <StatCard label="Winning" value={`${stats.winning_trades} / ${stats.total_trades}`} />
        <StatCard label="Capital" value={`₹${stats.initial_capital.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
      </div>
      <div className="bg-gray-900 rounded border border-gray-800 p-2">
        <MacroLineChart title="Equity Curve" height={180}
          series={[{ label: "Portfolio", color: "#60a5fa", data: equity_curve.map((e) => ({ date: e.date, value: e.value })) }]} />
      </div>
      {trades.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                {["Entry","Exit","Entry ₹","Exit ₹","Shares","PnL ₹","PnL %"].map((h) => (
                  <th key={h} className="text-left py-1.5 px-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-1.5 px-2">{t.entry_date}</td>
                  <td className="py-1.5 px-2">{t.exit_date}</td>
                  <td className="py-1.5 px-2">{t.entry_price.toFixed(2)}</td>
                  <td className="py-1.5 px-2">{t.exit_price.toFixed(2)}</td>
                  <td className="py-1.5 px-2">{t.shares}</td>
                  <td className={`py-1.5 px-2 ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.pnl >= 0 ? "+" : ""}{t.pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`py-1.5 px-2 ${t.pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
