import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Search, TrendingUp, SlidersHorizontal, FlaskConical, BarChart2, Wifi, WifiOff, RefreshCw, Trash2, AlertTriangle, GitBranch } from "lucide-react";
import { api } from "../lib/api";

interface SearchResult { symbol: string; name: string }

export default function Navbar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track browser connectivity so the user knows whether live data can be fetched.
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const search = useCallback((q: string) => {
    if (q.length < 1) { setResults([]); setOpen(false); setLoading(false); return; }
    setLoading(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await api.searchSymbols(q);
        setResults(res);
        setOpen(res.length > 0);
        setCursor(-1);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 200);
  }, []);

  useEffect(() => { search(query); }, [query, search]);

  const go = (symbol: string) => {
    setQuery(""); setResults([]); setOpen(false); setCursor(-1);
    navigate(`/stock/${symbol}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); const s = cursor >= 0 ? results[cursor] : results[0]; if (s) go(s.symbol); }
    else if (e.key === "Escape") { setOpen(false); setCursor(-1); }
  };

  const triggerSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    const sources = ["indices", "bhavcopy", "fii_dii", "currency", "fno_participant"];
    try {
      await Promise.all(sources.map((s) => api.triggerSync(s)));
      setSyncMsg("Syncing… dashboard will update shortly");
      // Navigate to dashboard then dispatch refresh after a short delay
      // (syncs are queued server-side, ~5-15s to complete)
      navigate("/");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("sv:dash-refresh"));
      }, 8000);
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 10000);
    }
  };

  const resetStockData = async () => {
    setResetting(true);
    try {
      await fetch("/api/screener/stock-data", { method: "DELETE" });
    } finally {
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  const navLinks = [
    { to: "/", label: "Dashboard", icon: TrendingUp },
    { to: "/screener", label: "Screener", icon: SlidersHorizontal },
    { to: "/backtest", label: "Backtest", icon: FlaskConical },
    { to: "/fno", label: "F&O", icon: BarChart2 },
    { to: "/markov", label: "Markov", icon: GitBranch },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 shadow-sm px-4 h-14 flex items-center gap-4">
      <Link to="/" className="text-blue-600 font-bold text-lg tracking-tight whitespace-nowrap flex items-center gap-1.5">
        <TrendingUp size={18} />
        StockVeda
      </Link>

      {/* Search */}
      <div className="relative flex-1 max-w-sm mx-auto">
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
          {loading && (
            <div className="absolute right-2.5 w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => { setOpen(false); setCursor(-1); }, 150)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search symbol… (↑↓ to navigate, Enter to select)"
            className="w-full bg-slate-100 text-slate-900 placeholder-slate-400 rounded-lg pl-8 pr-8 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white border border-transparent focus:border-blue-300 transition-all"
          />
        </div>
        {open && results.length > 0 && (
          <ul className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
            {results.map((r, i) => (
              <li key={r.symbol}>
                <button
                  onMouseDown={() => go(r.symbol)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
                    i === cursor ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                  }`}>
                  <span className="font-semibold w-24 shrink-0">{r.symbol}</span>
                  <span className="text-slate-500 text-xs truncate">{r.name}</span>
                  {i === cursor && <span className="text-xs text-blue-400 ml-auto shrink-0">↵ Enter</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Connectivity indicator */}
      <div
        title={online ? "Online — live data available" : "Offline — showing saved data only"}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
          online ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
        }`}>
        {online ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span className="hidden sm:inline">{online ? "Online" : "Offline"}</span>
      </div>

      {/* Sync button */}
      <div className="relative flex items-center">
        <button
          onClick={triggerSync}
          disabled={syncing}
          title="Sync market data (indices, bhavcopy, FII/DII, currency)"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all whitespace-nowrap ${
            syncing
              ? "bg-blue-50 text-blue-400 border-blue-200 cursor-not-allowed"
              : "bg-white text-slate-500 border-slate-200 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50"
          }`}>
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">{syncMsg ?? "Sync"}</span>
        </button>
      </div>

      {/* Reset stock data */}
      <button
        onClick={() => setShowResetConfirm(true)}
        title="Delete all fetched stock OHLCV data (watchlists kept)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all whitespace-nowrap">
        <Trash2 size={13} />
        <span className="hidden sm:inline">Reset Data</span>
      </button>

      {/* Confirm dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-50 rounded-lg shrink-0">
                <AlertTriangle size={18} className="text-red-500" />
              </div>
              <div>
                <div className="font-semibold text-slate-800 text-sm">Delete all stock data?</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                  This removes all downloaded OHLCV candles and indicator cache. Your watchlists are not affected.
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium">
                Cancel
              </button>
              <button
                onClick={resetStockData}
                disabled={resetting}
                className="px-4 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-lg transition-colors font-medium flex items-center gap-1.5">
                {resetting ? <><div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Deleting…</> : <><Trash2 size={12} /> Delete All</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nav links */}
      <div className="flex gap-1 text-sm font-medium whitespace-nowrap">
        {navLinks.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
          return (
            <Link key={to} to={to}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                active ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              }`}>
              <Icon size={14} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
