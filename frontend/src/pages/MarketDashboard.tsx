import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, DollarSign, Activity, BarChart2, Globe, SlidersHorizontal, FlaskConical } from "lucide-react";
import { api, type FiiDiiRow, type CurrencyRow, type IndexRow } from "../lib/api";

const SECTOR_INDICES = ["NIFTY IT", "NIFTY BANK", "NIFTY AUTO", "NIFTY FMCG", "NIFTY PHARMA", "NIFTY METAL", "NIFTY ENERGY", "NIFTY REALTY"];
const HEADLINE_INDICES = ["NIFTY 50", "NIFTY BANK", "SENSEX"];
const PIE_COLORS = ["#3b82f6", "#10b981"];

function pct(a: number, b: number) { return b !== 0 ? ((a - b) / b) * 100 : 0; }

interface IndexSummary { name: string; close: number; prev: number; change: number; changePct: number }

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

function IndexTile({ idx }: { idx: IndexSummary }) {
  const up = idx.changePct >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{idx.name}</span>
        {up ? <ArrowUpRight size={16} className="text-emerald-500" /> : <ArrowDownRight size={16} className="text-red-500" />}
      </div>
      <div className="text-2xl font-bold text-slate-800">{idx.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
      <div className={`text-sm font-semibold mt-1 ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? "+" : ""}{idx.changePct.toFixed(2)}%
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
  const [headlineIndices, setHeadlineIndices] = useState<IndexSummary[]>([]);
  const [sectorPerf, setSectorPerf] = useState<{ name: string; pct: number }[]>([]);
  const [fiiDii, setFiiDii] = useState<FiiDiiRow[]>([]);
  const [currency, setCurrency] = useState<CurrencyRow[]>([]);
  const [indexHistory, setIndexHistory] = useState<IndexRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const d30 = new Date(); d30.setDate(d30.getDate() - 30);
    const from30 = d30.toISOString().slice(0, 10);
    const d5 = new Date(); d5.setDate(d5.getDate() - 5);
    const from5 = d5.toISOString().slice(0, 10);

    Promise.allSettled([
      ...HEADLINE_INDICES.map((idx) => api.getIndices(idx).then((rows) => ({ idx, rows }))),
      ...SECTOR_INDICES.map((idx) => api.getIndices(idx, from5).then((rows) => ({ idx, rows }))),
      api.getIndices("NIFTY 50", from30),
      api.getFiiDii(from30),
      api.getCurrency("USDINR", from30),
    ]).then((results) => {
      const headlines: IndexSummary[] = [];
      const sectors: { name: string; pct: number }[] = [];

      results.slice(0, HEADLINE_INDICES.length).forEach((r) => {
        if (r.status !== "fulfilled") return;
        const { idx, rows } = r.value as { idx: string; rows: IndexRow[] };
        const sorted = [...rows].sort((a, b) => a.date > b.date ? -1 : 1);
        if (sorted.length < 2) return;
        const close = sorted[0].close, prev = sorted[1].close;
        headlines.push({ name: idx, close, prev, change: close - prev, changePct: pct(close, prev) });
      });

      results.slice(HEADLINE_INDICES.length, HEADLINE_INDICES.length + SECTOR_INDICES.length).forEach((r) => {
        if (r.status !== "fulfilled") return;
        const { idx, rows } = r.value as { idx: string; rows: IndexRow[] };
        const sorted = [...rows].sort((a, b) => a.date > b.date ? -1 : 1);
        if (sorted.length < 2) return;
        sectors.push({ name: idx.replace("NIFTY ", ""), pct: pct(sorted[0].close, sorted[1].close) });
      });

      const histR = results[HEADLINE_INDICES.length + SECTOR_INDICES.length];
      if (histR.status === "fulfilled")
        setIndexHistory([...(histR.value as IndexRow[])].sort((a, b) => a.date < b.date ? -1 : 1));

      const fiiR = results[HEADLINE_INDICES.length + SECTOR_INDICES.length + 1];
      if (fiiR.status === "fulfilled")
        setFiiDii([...(fiiR.value as FiiDiiRow[])].sort((a, b) => a.date < b.date ? -1 : 1).slice(-20));

      const curR = results[HEADLINE_INDICES.length + SECTOR_INDICES.length + 2];
      if (curR.status === "fulfilled")
        setCurrency([...(curR.value as CurrencyRow[])].filter(c => c.pair === "USDINR" || c.pair === "USDINR=X").sort((a, b) => a.date < b.date ? -1 : 1));

      setHeadlineIndices(headlines);
      setSectorPerf(sectors.sort((a, b) => b.pct - a.pct));
      setLoading(false);
    });
  }, []);

  const latestFii = fiiDii[fiiDii.length - 1];
  const latestCur = currency[currency.length - 1];
  const prevCur = currency[currency.length - 2];
  const curChange = latestCur && prevCur ? pct(latestCur.close, prevCur.close) : 0;
  const fiiPieData = latestFii
    ? [{ name: "FII Buy", value: Math.abs(latestFii.fii_buy) }, { name: "DII Buy", value: Math.abs(latestFii.dii_buy) }]
    : [];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-slate-500 text-sm">Loading market data…</div>
        <div className="text-xs text-slate-400">Fetching indices, FII/DII flows, currency…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Headline indices */}
      {headlineIndices.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {headlineIndices.map((idx) => <IndexTile key={idx.name} idx={idx} />)}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <Activity size={32} className="text-slate-300 mx-auto mb-3" />
          <div className="text-sm text-slate-500 mb-1">No index data available yet</div>
          <div className="text-xs text-slate-400">Run <code className="bg-slate-100 px-1 rounded">POST /api/sync/trigger/indices</code> to populate</div>
        </div>
      )}

      {/* Nifty 50 chart + stat cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">Nifty 50 — Last 30 days</span>
          </div>
          {indexHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={indexHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
            value={latestCur ? `₹${latestCur.close.toFixed(2)}` : "—"}
            sub={latestCur ? `${curChange >= 0 ? "+" : ""}${curChange.toFixed(3)}% today` : undefined}
            color={curChange < 0 ? "text-emerald-600" : curChange > 0 ? "text-red-500" : "text-slate-800"} />
          <StatCard icon={TrendingUp} label="FII Net (latest)"
            value={latestFii ? `₹${(latestFii.fii_net / 100).toFixed(0)} Cr` : "—"}
            color={latestFii && latestFii.fii_net >= 0 ? "text-emerald-600" : "text-red-500"} />
          <StatCard icon={Activity} label="DII Net (latest)"
            value={latestFii ? `₹${(latestFii.dii_net / 100).toFixed(0)} Cr` : "—"}
            color={latestFii && latestFii.dii_net >= 0 ? "text-emerald-600" : "text-red-500"} />
        </div>
      </div>

      {/* Sector performance + FII pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">Sector Performance (1 day %)</span>
          </div>
          {sectorPerf.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sectorPerf} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#475569", fontSize: 10 }} width={56} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="pct" name="Change %" radius={[0, 4, 4, 0]}>
                  {sectorPerf.map((e, i) => <Cell key={i} fill={e.pct >= 0 ? "#10b981" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No sector data — run indices sync.</div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">FII vs DII (today)</span>
          </div>
          {fiiPieData.length > 0 ? (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={fiiPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={4}>
                    {fiiPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-4 text-xs mt-1">
                {fiiPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-slate-500">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No FII/DII data</div>
          )}
        </div>
      </div>

      {/* FII/DII 20-day bar */}
      {fiiDii.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">FII / DII Net Flow — Last 20 days (₹ Cr)</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={fiiDii} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} interval={2} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => `${(v / 100).toFixed(0)}Cr`} width={54} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="fii_net" name="FII Net" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              <Bar dataKey="dii_net" name="DII Net" fill="#10b981" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate("/screener")}
          className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-xl p-4 text-left transition-all group shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <SlidersHorizontal size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">Screener</span>
          </div>
          <div className="text-xs text-slate-400">Filter stocks by fundamentals, delivery & shareholding</div>
        </button>
        <button onClick={() => navigate("/backtest")}
          className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-xl p-4 text-left transition-all group shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">Backtest</span>
          </div>
          <div className="text-xs text-slate-400">Test strategies on historical NSE price data</div>
        </button>
      </div>
    </div>
  );
}
