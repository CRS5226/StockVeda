import { useState, useRef, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";

export default function SymbolCombobox({ value, onChange, placeholder }: {
  value: string;
  onChange: (sym: string) => void;
  placeholder?: string;
}) {
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const search = useCallback((val: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (val.length < 1) { setResults([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      try {
        const res = await api.searchSymbols(val);
        setResults(res.slice(0, 8));
        setOpen(res.length > 0);
        setHighlighted(0);
      } catch { setResults([]); }
    }, 180);
  }, []);

  const pick = (sym: string) => { onChange(sym); setResults([]); setOpen(false); setHighlighted(-1); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const i = highlighted >= 0 ? highlighted : 0; if (results[i]) pick(results[i].symbol); }
    else if (e.key === "Escape") { setOpen(false); setHighlighted(-1); }
  };

  useEffect(() => {
    if (highlighted >= 0 && listRef.current)
      (listRef.current.children[highlighted] as HTMLElement)?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white border border-transparent focus-within:border-blue-300 transition-all">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input value={value}
          onChange={(e) => { const v = e.target.value.toUpperCase(); onChange(v); search(v); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Search symbol…"}
          className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none min-w-0 font-semibold" />
      </div>
      {open && results.length > 0 && (
        <ul ref={listRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((r, i) => (
            <li key={r.symbol}>
              <button onMouseDown={() => pick(r.symbol)} onMouseEnter={() => setHighlighted(i)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${i === highlighted ? "bg-blue-50" : "hover:bg-blue-50"}`}>
                <span className="font-semibold text-blue-700 w-24 shrink-0">{r.symbol}</span>
                <span className="text-slate-500 text-xs truncate">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
