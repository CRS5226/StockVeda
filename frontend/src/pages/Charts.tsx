import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, Download, Moon, Sun } from "lucide-react";
import ChartCanvas from "../components/ChartCanvas";
import SymbolCombobox from "../components/SymbolCombobox";
import { useChartData } from "../lib/useChartData";
import { loadChartTheme, saveChartTheme, type ChartTheme } from "../lib/chartTheme";

export const DEFAULT_CHART_SYMBOL = "HDFCBANK";

/** Full-screen, TradingView-style chart page. Fills everything below the navbar. */
export default function Charts() {
  const { symbol: routeSymbol } = useParams();
  const navigate = useNavigate();
  const symbol = (routeSymbol ?? DEFAULT_CHART_SYMBOL).toUpperCase();
  const [tf, setTf] = useState("1D");
  const [draft, setDraft] = useState(symbol);
  const [theme, setTheme] = useState<ChartTheme>(loadChartTheme);
  const dark = theme === "dark";
  const { timeframes, bars, loading, error, notice, fetching, fetchMissing } = useChartData(symbol, tf);

  // Keep the search box in step with the URL (back/forward, links).
  useEffect(() => setDraft(symbol), [symbol]);

  const pick = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (s) navigate(`/charts/${encodeURIComponent(s)}`);
  };

  const toggleTheme = () => {
    const next: ChartTheme = dark ? "light" : "dark";
    setTheme(next);
    saveChartTheme(next);
  };

  const empty = !loading && !fetching && !error && bars.length === 0;

  return (
    <div className={`h-full flex flex-col ${dark ? "bg-[#131722]" : "bg-white"}`}>
      {/* Top toolbar */}
      <div className={`h-11 shrink-0 flex items-center gap-3 px-3 border-b ${dark ? "border-[#2a2e39] bg-[#131722]" : "border-slate-200 bg-white"}`}>
        <div className="w-56">
          <SymbolCombobox value={draft} onChange={setDraft} onSelect={pick} placeholder="Search symbol…" />
        </div>
        <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>{symbol}</span>
        <div className={`w-px h-5 ${dark ? "bg-[#2a2e39]" : "bg-slate-200"}`} />
        <div className="flex items-center gap-0.5">
          {timeframes.map((t) => (
            <button key={t.key} onClick={() => setTf(t.key)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                t.key === tf
                  ? (dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600")
                  : (dark ? "text-slate-400 hover:bg-[#1e222d] hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
              }`}>
              {t.key}
            </button>
          ))}
        </div>
        <div className={`ml-auto flex items-center gap-3 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {(loading || fetching) && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
              {fetching ? "Downloading data…" : "Loading…"}
            </span>
          )}
          {notice && !fetching && <span>{notice}</span>}
          {bars.length > 0 && <span>{bars.length.toLocaleString()} bars</span>}
          <button onClick={toggleTheme} title={dark ? "Switch chart to light mode" : "Switch chart to dark mode"}
            className={`p-1.5 rounded transition-colors ${dark ? "text-slate-300 hover:bg-[#1e222d]" : "text-slate-500 hover:bg-slate-100"}`}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative flex-1 min-h-0">
        <ChartCanvas bars={bars} theme={theme} />
        {error && (
          <div className={`absolute inset-0 flex items-center justify-center ${dark ? "bg-[#131722]/80" : "bg-white/80"}`}>
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle size={16} /> {error}
            </div>
          </div>
        )}
        {empty && (
          <div className={`absolute inset-0 flex items-center justify-center ${dark ? "bg-[#131722]/80" : "bg-white/80"}`}>
            <div className={`flex flex-col items-center gap-3 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <span>No {tf} bars stored for {symbol} in this range.</span>
              <button onClick={fetchMissing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
                <Download size={13} /> Fetch data
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
