import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, DollarSign, Activity, BarChart2, Globe, SlidersHorizontal, FlaskConical } from "lucide-react";
import { api, type DashboardData } from "../lib/api";

const PIE_COLORS = ["#3b82f6", "#10b981"];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-500 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color }} className="font-medium">
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
};

function IndexTile({ idx }: { idx: DashboardData["headline"][number] }) {
  const up = idx.change_pct >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{idx.name}</span>
        {up ? <ArrowUpRight size={16} className="text-emerald-500" /> : <ArrowDownRight size={16} className="text-red-500" />}
      </div>
      <div className="text-2xl font-bold text-slate-800">{idx.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
      <div className={`text-sm font-semibold mt-1 ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
        <span className="text-slate-400 text-xs font-normal ml-1">({up ? "+" : ""}{idx.change.toFixed(2)})</span>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "text-slate-800" }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start gap-3">
      <div className="p-2 bg-blue-50 rounded-lg shrink-0">
        <Icon size={15} className="text-blue-500" />
      </div>
      <div>
        <div className="text-xs text-slate-500 mb-0.5">{label}</div>
        <div className={`text-base font-bold ${color}`}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function MarketDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDashboard()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-slate-500 text-sm">Loading market data…</div>
        <div className="text-xs text-slate-400">Fetching indices, FII/DII flows, currency…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <Activity size={32} className="text-slate-300 mx-auto mb-3" />
        <div className="text-sm text-slate-500">Failed to load dashboard data</div>
        <div className="text-xs text-slate-400 mt-1">{error}</div>
      </div>
    );
  }

  const { headline, sector_perf, nifty_hist, fii_latest, usdinr } = data;
  const fiiPieData = fii_latest
    ? [{ name: "FII Buy", value: Math.abs(fii_latest.fii_buy) }, { name: "DII Buy", value: Math.abs(fii_latest.dii_buy) }]
    : [];
  const curChange = usdinr?.change_pct ?? 0;

  return (
    <div className="flex flex-col gap-5">

      {/* Headline indices */}
      {headline.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {headline.map((idx) => <IndexTile key={idx.name} idx={idx} />)}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <Activity size={32} className="text-slate-300 mx-auto mb-3" />
          <div className="text-sm text-slate-500 mb-1">No index data available yet</div>
          <div className="text-xs text-slate-400">Trigger an indices sync to populate</div>
        </div>
      )}

      {/* Nifty 50 chart + stat cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">Nifty 50 — Last 30 days</span>
          </div>
          {nifty_hist.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={nifty_hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={["auto", "auto"]} width={60} tickFormatter={(v) => (v / 1000).toFixed(1) + "k"} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} name="Nifty 50" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No data</div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <StatCard icon={DollarSign} label="USD / INR"
            value={usdinr ? `₹${usdinr.close.toFixed(2)}` : "—"}
            sub={usdinr ? `${curChange >= 0 ? "+" : ""}${curChange.toFixed(3)}% today` : undefined}
            color={curChange < 0 ? "text-emerald-600" : curChange > 0 ? "text-red-500" : "text-slate-800"} />
          <StatCard icon={TrendingUp} label="FII Net (latest)"
            value={fii_latest ? `₹${(fii_latest.fii_net / 100).toFixed(0)} Cr` : "—"}
            color={fii_latest && fii_latest.fii_net >= 0 ? "text-emerald-600" : "text-red-500"} />
          <StatCard icon={Activity} label="DII Net (latest)"
            value={fii_latest ? `₹${(fii_latest.dii_net / 100).toFixed(0)} Cr` : "—"}
            color={fii_latest && fii_latest.dii_net >= 0 ? "text-emerald-600" : "text-red-500"} />
        </div>
      </div>

      {/* Sector performance + FII pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">Sector Performance (1 day %)</span>
          </div>
          {sector_perf.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(160, sector_perf.length * 36)}>
              <BarChart data={sector_perf} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#475569", fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "Change"]} />
                <Bar dataKey="pct" radius={[0, 3, 3, 0]}
                  fill="#22c55e"
                  label={false}>
                  {sector_perf.map((entry, i) => (
                    <Cell key={i} fill={entry.pct >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No sector data</div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">FII vs DII (today)</span>
          </div>
          {fiiPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={fiiPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                    {fiiPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`₹${(Number(v) / 100).toFixed(0)} Cr`, ""]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-1">
                {fiiPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1 text-xs text-slate-500">
                    <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Quick nav */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate("/screener")}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:shadow-md transition-all group">
          <SlidersHorizontal size={18} className="text-blue-500 mb-2" />
          <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">Screener</div>
          <div className="text-xs text-slate-400 mt-0.5">Filter stocks by fundamentals & technicals</div>
        </button>
        <button onClick={() => navigate("/backtest")}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:shadow-md transition-all group">
          <FlaskConical size={18} className="text-blue-500 mb-2" />
          <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">Backtest</div>
          <div className="text-xs text-slate-400 mt-0.5">Test strategies on historical data</div>
        </button>
      </div>

    </div>
  );
}
