import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  DollarSign, Activity, BarChart2, Globe, SlidersHorizontal,
  FlaskConical, Zap,
} from "lucide-react";
import { api, type DashboardData } from "../lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

function fmtNum(n: number, dec = 2) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function fmtDate(d?: string) {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function pctBg(p: number) {
  return p >= 0
    ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
    : "bg-red-50 border-red-200 hover:bg-red-100";
}

// ── sub-components ─────────────────────────────────────────────────────────

function IndexTile({ idx }: { idx: DashboardData["headline"][number] }) {
  const up = idx.change_pct >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate pr-1">{idx.name.replace("NIFTY ", "")}</span>
        {up ? <ArrowUpRight size={14} className="text-emerald-500 shrink-0" /> : <ArrowDownRight size={14} className="text-red-500 shrink-0" />}
      </div>
      <div className="text-lg font-bold text-slate-800">{fmtNum(idx.close, 2)}</div>
      <div className={`text-xs font-semibold mt-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
        <span className="text-slate-400 font-normal ml-1">({up ? "+" : ""}{fmtNum(idx.change, 2)})</span>
      </div>
      {idx.date && <div className="text-[10px] text-slate-300 mt-1">as of {fmtDate(idx.date)}</div>}
    </div>
  );
}

function MktTile({ name, close, change_pct, change, region, date }: {
  name: string; close: number; change_pct: number; change: number; region?: string; date?: string;
}) {
  const up = change_pct >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate pr-1">{name}</span>
        {up ? <ArrowUpRight size={14} className="text-emerald-500 shrink-0" /> : <ArrowDownRight size={14} className="text-red-500 shrink-0" />}
      </div>
      {region && <div className="text-[10px] text-slate-400 mb-1">{region}</div>}
      <div className="text-lg font-bold text-slate-800">{fmtNum(close, 2)}</div>
      <div className={`text-xs font-semibold mt-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? "+" : ""}{change_pct.toFixed(2)}%
        <span className="text-slate-400 font-normal ml-1">({up ? "+" : ""}{fmtNum(change, 2)})</span>
      </div>
      {date && <div className="text-[10px] text-slate-300 mt-1">as of {fmtDate(date)}</div>}
    </div>
  );
}

function SectorCard({ s }: { s: { name: string; pct: number } }) {
  const up = s.pct >= 0;
  return (
    <div className={`border rounded-lg p-2 transition-colors cursor-default ${pctBg(s.pct)}`}>
      <div className="text-[11px] font-semibold text-slate-600 truncate leading-tight">{s.name}</div>
      <div className={`text-sm font-bold mt-0.5 ${up ? "text-emerald-700" : "text-red-600"}`}>
        {up ? "+" : ""}{s.pct.toFixed(2)}%
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, date, color = "text-slate-800" }: {
  icon: React.ElementType; label: string; value: string; sub?: string; date?: string; color?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start gap-3">
      <div className="p-2 bg-blue-50 rounded-lg shrink-0">
        <Icon size={14} className="text-blue-500" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 mb-0.5">{label}</div>
        <div className={`text-base font-bold truncate ${color}`}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        {date && <div className="text-[10px] text-slate-300 mt-0.5">as of {fmtDate(date)}</div>}
      </div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-400 mb-1">{label}</div>
      <div className="font-semibold text-slate-700">{Number(payload[0].value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
    </div>
  );
};

function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={13} className="text-slate-400" />
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{children}</span>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function MarketDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const status = await api.dashboardStatus();
        if (cancelled) return;
        if (!status.populated) {
          setSeeding(true);
          await api.bootstrap();
          if (cancelled) return;
        }
        const d = await api.getDashboard();
        if (cancelled) return;
        setData(d);
        setSeeding(false);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setSeeding(false);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-10 h-10 border-[3px] border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        {seeding ? (
          <>
            <div className="text-slate-600 text-sm font-medium">Setting up for the first time…</div>
            <div className="text-xs text-slate-400 text-center max-w-xs">
              Downloading market data. This runs once and takes ~30s.
            </div>
          </>
        ) : (
          <div className="text-slate-500 text-sm">Loading market data…</div>
        )}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <Activity size={32} className="text-slate-300 mx-auto mb-3" />
        <div className="text-sm text-slate-500">Failed to load dashboard</div>
        <div className="text-xs text-slate-400 mt-1">{error}</div>
      </div>
    );
  }

  const { headline, sector_perf, nifty_hist, fii_latest, usdinr, india_vix,
          us_markets, us_sectors, global_markets } = data;
  const curChange = usdinr?.change_pct ?? 0;
  const vixChange = india_vix?.change_pct ?? 0;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Indian Headline Indices ── */}
      <section>
        <SectionLabel icon={BarChart2}>Indian Markets</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {headline.map((idx) => <IndexTile key={idx.name} idx={idx} />)}
        </div>
      </section>

      {/* ── Nifty chart + stat cards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">Nifty 50 — Last 30 days</span>
          </div>
          {nifty_hist.length > 0 ? (
            <ResponsiveContainer width="100%" height={175}>
              <LineChart data={nifty_hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={["auto", "auto"]} width={58} tickFormatter={(v) => (v / 1000).toFixed(1) + "k"} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} />
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
            date={usdinr?.date}
            color={curChange < 0 ? "text-emerald-600" : curChange > 0 ? "text-red-500" : "text-slate-800"} />
          <StatCard icon={Zap} label="India VIX"
            value={india_vix ? india_vix.close.toFixed(2) : "—"}
            sub={india_vix ? `${vixChange >= 0 ? "+" : ""}${vixChange.toFixed(2)}% today` : undefined}
            date={india_vix?.date}
            color={india_vix ? (india_vix.close > 20 ? "text-red-500" : india_vix.close > 15 ? "text-amber-500" : "text-emerald-600") : "text-slate-800"} />
          <StatCard icon={TrendingUp} label="FII Net"
            value={fii_latest ? `₹${(fii_latest.fii_net / 100).toFixed(0)} Cr` : "—"}
            sub={fii_latest ? `DII Net: ₹${(fii_latest.dii_net / 100).toFixed(0)} Cr` : undefined}
            date={fii_latest?.date}
            color={fii_latest && fii_latest.fii_net >= 0 ? "text-emerald-600" : "text-red-500"} />
        </div>
      </div>

      {/* ── Sector Performance grid ── */}
      <section>
        <SectionLabel icon={Activity}>Indian Sector Performance (1-day %)</SectionLabel>
        {sector_perf.length > 0 ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {sector_perf.map((s) => <SectorCard key={s.name} s={s} />)}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400">No sector data</div>
        )}
      </section>

      {/* ── FII / DII detail ── */}
      {fii_latest && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-700">FII / DII Flows — {fii_latest.date}</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: "FII Buy",  val: fii_latest.fii_buy,  up: true  },
              { label: "FII Sell", val: fii_latest.fii_sell, up: false },
              { label: "FII Net",  val: fii_latest.fii_net,  up: fii_latest.fii_net  >= 0 },
              { label: "DII Buy",  val: fii_latest.dii_buy,  up: true  },
              { label: "DII Sell", val: fii_latest.dii_sell, up: false },
              { label: "DII Net",  val: fii_latest.dii_net,  up: fii_latest.dii_net  >= 0 },
            ].map(({ label, val, up }) => (
              <div key={label} className="text-center">
                <div className="text-xs text-slate-400 mb-1">{label}</div>
                <div className={`text-sm font-bold ${up ? "text-emerald-600" : "text-red-500"}`}>
                  ₹{(val / 100).toFixed(0)} Cr
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── US Markets + US Sectors ── */}
      <section>
        <SectionLabel icon={Globe}>US Markets</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {us_markets.map((m) => <MktTile key={m.name} {...m} />)}
        </div>
        {us_sectors.length > 0 && (
          <>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 ml-0.5">US Sectors (ETF %)</div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {us_sectors.map((s) => (
                <div key={s.name} className={`border rounded-lg p-2 transition-colors ${pctBg(s.change_pct)}`}>
                  <div className="text-[11px] font-semibold text-slate-600 truncate leading-tight">{s.name}</div>
                  <div className={`text-sm font-bold mt-0.5 ${s.change_pct >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Asia-Pacific + Europe ── */}
      {global_markets.length > 0 && (
        <section>
          <SectionLabel icon={Globe}>Asia-Pacific &amp; Europe</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {global_markets.map((m) => <MktTile key={m.name} {...m} />)}
          </div>
        </section>
      )}

      {/* ── Quick nav ── */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate("/screener")}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:shadow-md transition-all group">
          <SlidersHorizontal size={18} className="text-blue-500 mb-2" />
          <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">Screener</div>
          <div className="text-xs text-slate-400 mt-0.5">Filter stocks by fundamentals &amp; technicals</div>
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
