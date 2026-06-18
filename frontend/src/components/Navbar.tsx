import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Search, TrendingUp, SlidersHorizontal, FlaskConical } from "lucide-react";
import { api } from "../lib/api";

export default function Navbar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sym = cursor >= 0 ? results[cursor] : results[0];
      if (sym) go(sym);
    } else if (e.key === "Escape") {
      setOpen(false); setCursor(-1);
    }
  };

  const navLinks = [
    { to: "/", label: "Dashboard", icon: TrendingUp },
    { to: "/screener", label: "Screener", icon: SlidersHorizontal },
    { to: "/backtest", label: "Backtest", icon: FlaskConical },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 px-4 h-14 flex items-center gap-4">
      <Link to="/" className="text-blue-400 font-bold text-lg tracking-tight whitespace-nowrap flex items-center gap-1.5">
        <TrendingUp size={18} className="text-blue-400" />
        StockVeda
      </Link>

      {/* Search */}
      <div className="relative flex-1 max-w-sm mx-auto">
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-gray-500 pointer-events-none" />
          {loading && (
            <div className="absolute right-2.5 w-3 h-3 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => { setOpen(false); setCursor(-1); }, 150)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search symbol…"
            className="w-full bg-gray-800 text-gray-100 placeholder-gray-500 rounded pl-8 pr-8 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {open && results.length > 0 && (
          <ul className="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded shadow-xl z-50 max-h-64 overflow-y-auto">
            {results.map((sym, i) => (
              <li key={sym}>
                <button
                  onMouseDown={() => go(sym)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                    i === cursor ? "bg-blue-600 text-white" : "text-gray-100 hover:bg-gray-700"
                  }`}
                >
                  <Search size={12} className={i === cursor ? "text-white" : "text-gray-500"} />
                  <span className="font-medium">{sym}</span>
                  <span className="text-xs text-gray-400 ml-auto">↵</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Nav links */}
      <div className="flex gap-1 text-sm font-medium whitespace-nowrap">
        {navLinks.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
          return (
            <Link key={to} to={to}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors ${
                active ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
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
