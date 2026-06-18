import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function Navbar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 1) { setResults([]); setOpen(false); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await api.searchSymbols(query);
        setResults(res);
        setOpen(res.length > 0);
      } catch { setResults([]); }
    }, 200);
  }, [query]);

  const go = (symbol: string) => {
    setQuery(""); setResults([]); setOpen(false);
    navigate(`/stock/${symbol}`);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 px-4 h-14 flex items-center gap-4">
      <Link to="/" className="text-blue-400 font-bold text-lg tracking-tight whitespace-nowrap">
        StockVeda
      </Link>

      {/* Search */}
      <div className="relative flex-1 max-w-md mx-auto">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) go(results[0]); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search symbol…"
          className="w-full bg-gray-800 text-gray-100 placeholder-gray-500 rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
        />
        {open && (
          <ul className="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded shadow-xl z-50">
            {results.map((sym) => (
              <li key={sym}>
                <button
                  onMouseDown={() => go(sym)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-100 hover:bg-gray-700"
                >
                  {sym}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Nav links */}
      <div className="flex gap-4 text-sm font-medium whitespace-nowrap">
        <Link to="/" className="text-gray-400 hover:text-gray-100">Screener</Link>
        <Link to="/backtest" className="text-gray-400 hover:text-gray-100">Backtest</Link>
        <Link to="/macro" className="text-gray-400 hover:text-gray-100">Macro</Link>
      </div>
    </nav>
  );
}
