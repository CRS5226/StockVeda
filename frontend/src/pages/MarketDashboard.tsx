import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus,
  ArrowUpRight, ArrowDownRight, DollarSign, Activity, BarChart2, Globe,
} from "lucide-react";
import { api, type FiiDiiRow, type CurrencyRow, type IndexRow } from "../lib/api";

// Sector indices we try to load
const SECTOR_INDICES = [
  "NIFTY IT", "NIFTY BANK", "NIFTY AUTO", "NIFTY FMCG",
  "NIFTY PHARMA", "NIFTY METAL", "NIFTY ENERGY", "NIFTY REALTY",
];
const HEADLINE_INDICES = ["NIFTY 50", "NIFTY BANK", "SENSEX"];
const COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#a78bfa", "#f87171", "#fb923c", "#818cf8", "#4ade80"];

function pct(a: number, b: number) { return b !== 0 ? ((a - b) / b) * 100 : 0; }

interface IndexSummary {
  name: string;
  close: number;
  prev: number;
  change: number;
  changePct: number;
}

function StatCard({ icon: Icon, label, value, sub, positive }: {
  icon: React.ElementType; label: string; value: string; sub?: string; positive?: boolean;
}) {
  const color = positive === undefined ? "text-gray-100"
    : positive ? "text-green-400" : "text-red-400";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-start gap-3">
      <div className="p-2 bg-gray-800 rounded-lg shrink-0">
        <Icon size={16} className="text-blue-400" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <div className={`text-lg font-bold leading-tight ${color}`}>{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function IndexTile({ idx }: { idx: IndexSummary }) {
  const up = idx.changePct >= 0;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-medium">{idx.name}</span>
        {up ? <ArrowUpRight size={16} className="text-green-400" /> : <ArrowDownRight size={16} className="text-red-400" />}
      </div>
      <div className="text-xl font-bold text-gray-100">{idx.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
      <div className={`text-sm font-medium mt-1 ${up ? "text-green-400" : "text-red-400"}`}>
        {up ? "+" : ""}{idx.changePct.toFixed(2)}%
        <span className="text-gray-500 text-xs ml-1">({up ? "+" : ""}{idx.change.toFixed(2)})</span>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs">
      <div className="text-gray-400 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

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
    const d2 = new Date(); d2.setDate(d2.getDate() - 5);
    const from5 = d2.toISOString().slice(0, 10);

    Promise.allSettled([
      // Headline indices - last 2 rows each
      ...HEADLINE_INDICES.map((idx) => api.getIndices(idx).then((rows) => ({ idx, rows }))),
      // Sector indices - last 2 rows each
      ...SECTOR_INDICES.map((idx) => api.getIndices(idx, from5).then((rows) => ({ idx, rows }))),
      // Nifty 50 history for sparkline
      api.getIndices("NIFTY 50", from30),
      // FII/DII last 30 days
      api.getFiiDii(from30),
      // Currency
      api.getCurrency(undefined, from30),
    ]).then((results) => {
      const headlines: IndexSummary[] = [];
      const sectors: { name: string; pct: number }[] = [];

      results.slice(0, HEADLINE_INDICES.length).forEach((r) => {
        if (r.status !== "fulfilled") return;
        const { idx, rows } = r.value as { idx: string; rows: IndexRow[] };
        const sorted = [...rows].sort((a, b) => a.date > b.date ? -1 : 1);
        if (sorted.length < 2) return;
        const close = sorted[0].close;
        const prev = sorted[1].close;
        headlines.push({ name: idx, close, prev, change: close - prev, changePct: pct(close, prev) });
      });

      results.slice(HEADLINE_INDICES.length, HEADLINE_INDICES.length + SECTOR_INDICES.length).forEach((r) => {
        if (r.status !== "fulfilled") return;
        const { idx, rows } = r.value as { idx: string; rows: IndexRow[] };
        const sorted = [...rows].sort((a, b) => a.date > b.date ? -1 : 1);
        if (sorted.length < 2) return;
        const close = sorted[0].close;
        const prev = sorted[1].close;
        sectors.push({ name: idx.replace("NIFTY ", ""), pct: pct(close, prev) });
      });

      const histResult = results[HEADLINE_INDICES.length + SECTOR_INDICES.length];
      if (histResult.status === "fulfilled") {
        const rows = histResult.value as IndexRow[];
        setIndexHistory([...rows].sort((a, b) => a.date < b.date ? -1 : 1));
      }

      const fiiResult = results[HEADLINE_INDICES.length + SECTOR_INDICES.length + 1];
      if (fiiResult.status === "fulfilled") {
        const rows = fiiResult.value as FiiDiiRow[];
        setFiiDii([...rows].sort((a, b) => a.date < b.date ? -1 : 1).slice(-20));
      }

      const curResult = results[HEADLINE_INDICES.length + SECTOR_INDICES.length + 2];
      if (curResult.status === "fulfilled") {
        const rows = curResult.value as CurrencyRow[];
        const usdinr = rows.filter((c) => c.pair === "USDINR=X").sort((a, b) => a.date < b.date ? -1 : 1);
        setCurrency(usdinr);
      }

      setHeadlineIndices(headlines);
      setSectorPerf(sectors.sort((a, b) => b.pct - a.pct));
      setLoading(false);
    });
  }, []);

  // FII/DII pie for latest day
  const latestFii = fiiDii[fiiDii.length - 1];
  const fiiPieData = latestFii ? [
    { name: "FII Buy", value: Math.abs(latestFii.fii_buy) },
    { name: "DII Buy", value: Math.abs(latestFii.dii_buy) },
  ] : [];

  const latestCurrency = currency[currency.length - 1];
  const prevCurrency = currency[currency.length - 2];
  const currencyChange = latestCurrency && prevCurrency
    ? pct(latestCurrency.close, prevCurrency.close) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Loading overlay */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-sm text-gray-500">Loading market data…</span>
          </div>
        </div>
      )}

      {!loading && (
        <>
          {/* Headline indices */}
          {headlineIndices.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {headlineIndices.map((idx) => <IndexTile key={idx.name} idx={idx} />)}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
              <Activity size={32} className="text-gray-700 mx-auto mb-2" />
              <div className="text-sm text-gray-500">No index data yet — run <code className="text-blue-400">sync/trigger/indices</code> first.</div>
            </div>
          )}

          {/* Nifty 50 sparkline + stat cards row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Nifty 50 30-day chart */}
            <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-300">Nifty 50 — Last 30 days</span>
              </div>
              {indexHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={indexHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }}
                      tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }}
                      domain={["auto", "auto"]} width={60}
                      tickFormatter={(v) => (v / 1000).toFixed(1) + "k"} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="close" stroke="#60a5fa"
                      strokeWidth={2} dot={false} name="Nifty 50" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex items-center justify-center text-gray-600 text-sm">No data</div>
              )}
            </div>

            {/* Stat cards */}
            <div className="flex flex-col gap-3">
              <StatCard icon={DollarSign} label="USD/INR"
                value={latestCurrency ? `₹${latestCurrency.close.toFixed(2)}` : "—"}
                sub={latestCurrency ? `${currencyChange >= 0 ? "+" : ""}${currencyChange.toFixed(2)}% today` : undefined}
                positive={currencyChange < 0} />
              <StatCard icon={TrendingUp} label="FII Net (today)"
                value={latestFii ? `₹${(latestFii.fii_net / 100).toFixed(0)} Cr` : "—"}
                positive={latestFii ? latestFii.fii_net >= 0 : undefined} />
              <StatCard icon={Activity} label="DII Net (today)"
                value={latestFii ? `₹${(latestFii.dii_net / 100).toFixed(0)} Cr` : "—"}
                positive={latestFii ? latestFii.dii_net >= 0 : undefined} />
            </div>
          </div>

          {/* Sector performance + FII/DII charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Sector bar chart */}
            <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-300">Sector Performance (1 day %)</span>
              </div>
              {sectorPerf.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={sectorPerf} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }}
                      tickFormatter={(v) => `${v.toFixed(1)}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 10 }} width={56} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="pct" name="Change %" radius={[0, 3, 3, 0]}>
                      {sectorPerf.map((entry, i) => (
                        <Cell key={i} fill={entry.pct >= 0 ? "#22c55e" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex items-center justify-center text-gray-600 text-sm">No sector data — run indices sync.</div>
              )}
            </div>

            {/* FII/DII pie */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-300">FII vs DII Buy (today)</span>
              </div>
              {fiiPieData.length > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={fiiPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                        dataKey="value" paddingAngle={3}>
                        {fiiPieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 text-xs mt-1">
                    {fiiPieData.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                        <span className="text-gray-400">{d.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-44 flex items-center justify-center text-gray-600 text-sm">No FII data</div>
              )}
            </div>
          </div>

          {/* FII/DII 30-day bar chart */}
          {fiiDii.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-300">FII / DII Net Flow — Last 20 days (₹ Cr)</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={fiiDii} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }}
                    tickFormatter={(v) => v.slice(5)} interval={2} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }}
                    tickFormatter={(v) => `${(v / 100).toFixed(0)}Cr`} width={54} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="fii_net" name="FII Net" fill="#60a5fa" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="dii_net" name="DII Net" fill="#34d399" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => navigate("/screener")}
              className="bg-gray-900 border border-gray-800 hover:border-blue-600 rounded-lg p-4 text-left transition-colors group">
              <div className="flex items-center gap-2 mb-1">
                <Minus size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-200 group-hover:text-blue-400 transition-colors">Screener</span>
              </div>
              <div className="text-xs text-gray-500">Filter stocks by fundamentals, delivery, shareholding</div>
            </button>
            <button onClick={() => navigate("/backtest")}
              className="bg-gray-900 border border-gray-800 hover:border-blue-600 rounded-lg p-4 text-left transition-colors group">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-200 group-hover:text-blue-400 transition-colors">Backtest</span>
              </div>
              <div className="text-xs text-gray-500">Test strategies on historical price data</div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
