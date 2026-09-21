import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, PiggyBank, Calculator, Dices, Play } from "lucide-react";
import { useMutualFundStore } from "../store/useMutualFundStore";
import { api, MfProjection } from "../lib/api";
import MacroLineChart from "../components/MacroLineChart";
import { PlanOptionBadges } from "./MutualFunds";

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(dec);
}

function fmtInr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function MetricCard({ label, value, up }: { label: string; value: string; up?: boolean }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-sm font-bold ${up === true ? "text-emerald-600" : up === false ? "text-red-500" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}

// Forward trading-day labels from as_of_date — skips Sat/Sun, no holiday calendar
// needed for a "what could happen" scenario chart (mirrors MonteCarloSimulation.tsx).
function forwardBusinessDates(asOfDate: string, horizonDays: number): string[] {
  const dates: string[] = [asOfDate];
  const cur = new Date(asOfDate + "T00:00:00");
  while (dates.length <= horizonDays) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day === 0 || day === 6) continue;
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}

function SipCalculator({ schemeCode }: { schemeCode: string }) {
  const [monthlyAmount, setMonthlyAmount] = useState(5000);
  const [startDate, setStartDate] = useState(new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10));
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.getMfSip>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.getMfSip(schemeCode, { monthly_amount: monthlyAmount, start_date: startDate });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const gain = result ? result.current_value - result.invested : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calculator size={15} className="text-blue-600" />
        <h2 className="text-sm font-bold text-slate-800">SIP Calculator</h2>
        <span className="text-xs text-slate-400">against this fund's real historical NAV</span>
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Monthly Amount (₹)</label>
          <input
            type="number" min={100} value={monthlyAmount}
            onChange={(e) => setMonthlyAmount(Number(e.target.value))}
            className="w-32 text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Start Date</label>
          <input
            type="date" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Play size={13} /> {loading ? "Calculating…" : "Calculate"}
        </button>
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Invested" value={`₹${fmtInr(result.invested)}`} />
          <MetricCard label="Current Value" value={`₹${fmtInr(result.current_value)}`} />
          <MetricCard label="Gain/Loss" value={`${gain != null && gain >= 0 ? "+" : ""}₹${fmtInr(gain)}`} up={gain != null ? gain >= 0 : undefined} />
          <MetricCard label="XIRR" value={result.xirr != null ? `${result.xirr >= 0 ? "+" : ""}${fmt(result.xirr)}%` : "—"} up={result.xirr != null ? result.xirr >= 0 : undefined} />
        </div>
      )}
    </div>
  );
}

function ProjectionPanel({ schemeCode }: { schemeCode: string }) {
  const [horizonDays, setHorizonDays] = useState(180);
  const [result, setResult] = useState<MfProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.getMfProjection(schemeCode, { horizon_days: horizonDays, n_simulations: 1000 });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const series = useMemo(() => {
    if (!result) return [];
    const dates = forwardBusinessDates(result.as_of_date, result.horizon_days);
    const zip = (values: number[], label: string, color: string) => ({
      label, color, data: values.map((v, i) => ({ date: dates[i], value: v })),
    });
    return [
      zip(result.percentile_paths.p95, "p95", "#cbd5e1"),
      zip(result.percentile_paths.p50, "p50 (median)", "#3b82f6"),
      zip(result.percentile_paths.p5, "p5", "#cbd5e1"),
    ];
  }, [result]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <Dices size={15} className="text-blue-600" />
        <h2 className="text-sm font-bold text-slate-800">NAV Projection</h2>
      </div>
      <div className="text-xs text-slate-400 mb-3">
        Monte Carlo (GBM) scenario range from this fund's own historical drift/volatility — a range of plausible outcomes, not a forecast promise.
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Horizon (days)</label>
          <select
            value={horizonDays}
            onChange={(e) => setHorizonDays(Number(e.target.value))}
            className="text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
            <option value={1095}>3 years</option>
          </select>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Play size={13} /> {loading ? "Simulating…" : "Run Projection"}
        </button>
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      {result && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <MetricCard label="Median NAV" value={`₹${fmt(result.percentile_paths.p50[result.percentile_paths.p50.length - 1])}`} />
            <MetricCard label="p5 (bearish)" value={`₹${fmt(result.percentile_paths.p5[result.percentile_paths.p5.length - 1])}`} />
            <MetricCard label="p95 (bullish)" value={`₹${fmt(result.percentile_paths.p95[result.percentile_paths.p95.length - 1])}`} />
          </div>
          <MacroLineChart height={260} series={series} />
        </>
      )}
    </div>
  );
}

export default function MutualFundDetail() {
  const { schemeCode } = useParams<{ schemeCode: string }>();
  const navigate = useNavigate();
  const { detail, detailLoading, detailError, loadSchemeDetail, clearDetail } = useMutualFundStore();

  useEffect(() => {
    if (schemeCode) loadSchemeDetail(schemeCode);
    return () => clearDetail();
  }, [schemeCode, loadSchemeDetail, clearDetail]);

  if (detailLoading) {
    return <div className="text-center py-16 text-slate-400 text-sm">Loading fund data…</div>;
  }
  if (detailError || !detail) {
    return (
      <div className="text-center py-16">
        <div className="text-red-500 text-sm mb-3">{detailError ?? "Fund not found"}</div>
        <button onClick={() => navigate("/mutual-funds")} className="text-sm text-blue-600 hover:underline">
          ← Back to Mutual Funds
        </button>
      </div>
    );
  }

  const { meta, risk } = detail;
  const returns = [
    { label: "1M", value: detail.return_1m },
    { label: "3M", value: detail.return_3m },
    { label: "6M", value: detail.return_6m },
    { label: "1Y", value: detail.return_1y },
    { label: "3Y CAGR", value: detail.cagr_3y },
    { label: "5Y CAGR", value: detail.cagr_5y },
  ];

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => navigate("/mutual-funds")}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 w-fit">
        <ArrowLeft size={14} /> Back to Mutual Funds
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-50 rounded-lg mt-0.5">
            <PiggyBank size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">{meta.scheme_name}</h1>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <span>{meta.amc}</span>
              <PlanOptionBadges plan={meta.plan} option={meta.option_type} />
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {meta.category.replace(/^Open Ended Schemes\(|\)$/g, "")}
              {meta.isin ? ` · ${meta.isin}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">NAV as of {detail.latest_nav_date}</div>
          <div className="text-2xl font-bold text-slate-800">₹{fmt(detail.latest_nav)}</div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Returns</div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {returns.map((r) => (
            <MetricCard
              key={r.label}
              label={r.label}
              value={r.value != null ? `${r.value >= 0 ? "+" : ""}${fmt(r.value)}%` : "—"}
              up={r.value != null ? r.value >= 0 : undefined}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">
          Risk (vs {risk.benchmark}, {risk.benchmark_type} index)
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <MetricCard label="Volatility" value={risk.volatility_annualized_pct != null ? `${fmt(risk.volatility_annualized_pct)}%` : "—"} />
          <MetricCard label="Sharpe" value={fmt(risk.sharpe)} up={risk.sharpe != null ? risk.sharpe >= 0 : undefined} />
          <MetricCard label="Sortino" value={fmt(risk.sortino)} up={risk.sortino != null ? risk.sortino >= 0 : undefined} />
          <MetricCard label="Max Drawdown" value={risk.max_drawdown_pct != null ? `${fmt(risk.max_drawdown_pct)}%` : "—"} up={false} />
          <MetricCard label="Beta" value={fmt(risk.beta)} />
          <MetricCard label="Alpha (ann.)" value={risk.alpha_annualized_pct != null ? `${fmt(risk.alpha_annualized_pct)}%` : "—"} up={risk.alpha_annualized_pct != null ? risk.alpha_annualized_pct >= 0 : undefined} />
        </div>
        <div className="text-xs text-slate-400 mt-1.5">
          Risk-free rate assumed {fmt(risk.risk_free_rate_pct)}%. Beta/alpha use {risk.benchmark}'s price-return index, not a total-return benchmark — alpha is understated relative to the TRI benchmark funds are officially measured against.
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <MacroLineChart
          title="NAV History"
          height={320}
          series={[{ label: "NAV", color: "#2563eb", data: detail.nav_history.map((p) => ({ date: p.date, value: p.nav })) }]}
        />
      </div>

      {schemeCode && <SipCalculator schemeCode={schemeCode} />}
      {schemeCode && <ProjectionPanel schemeCode={schemeCode} />}
    </div>
  );
}
