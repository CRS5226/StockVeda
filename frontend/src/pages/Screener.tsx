import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, X, ChevronDown, RefreshCw, CheckCircle2,
  AlertCircle, BookmarkPlus, Trash2, SlidersHorizontal,
} from "lucide-react";
import { api } from "../lib/api";
import { useScreenerStore } from "../store/useScreenerStore";
import ScreenerFilters from "../components/ScreenerFilters";

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, dec = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function pct(n: number | undefined | null) {
  if (n == null) return "—";
  const v = n.toFixed(2);
  return n >= 0 ? `+${v}%` : `${v}%`;
}

// ── Stock Picker ────────────────────────────────────────────────────────────

function SymbolSearch({ onAdd }: { onAdd: (sym: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const search = useCallback((val: string) => {
    if (val.length < 1) { setResults([]); setOpen(false); setHighlighted(-1); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await api.searchSymbols(val);
        setResults(res.slice(0, 8));
        setOpen(res.length > 0);
        setHighlighted(0);
      } catch { setResults([]); }
    }, 180);
  }, []);

  useEffect(() => { search(q); }, [q, search]);

  const pick = (sym: string) => { onAdd(sym); setQ(""); setResults([]); setOpen(false); setHighlighted(-1); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = highlighted >= 0 ? highlighted : 0;
      if (results[idx]) pick(results[idx].symbol);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  };

  useEffect(() => {
    if (highlighted >= 0 && listRef.current) {
      const item = listRef.current.children[highlighted] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white border border-transparent focus-within:border-blue-300 transition-all">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search symbol to add…"
          className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none min-w-0"
        />
      </div>
      {open && results.length > 0 && (
        <ul ref={listRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((r, i) => (
            <li key={r.symbol}>
              <button
                onMouseDown={() => pick(r.symbol)}
                onMouseEnter={() => setHighlighted(i)}
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

// ── Preset / Watchlist dropdown ─────────────────────────────────────────────

function LoadPresetMenu() {
  const [open, setOpen] = useState(false);
  const { presets, watchlists, loadPreset } = useScreenerStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all">
        Load List <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-44 py-1">
          {presets.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Index Presets</div>
              {presets.map((p) => (
                <button key={p.id} onMouseDown={() => { loadPreset(p.symbols); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between">
                  <span>{p.label}</span>
                  <span className="text-xs text-slate-400">{p.count}</span>
                </button>
              ))}
            </>
          )}
          {watchlists.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">My Watchlists</div>
              {watchlists.map((w) => (
                <button key={w.id} onMouseDown={() => { loadPreset(w.symbols); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between">
                  <span className="truncate">{w.name}</span>
                  <span className="text-xs text-slate-400 shrink-0 ml-2">{w.symbols.length}</span>
                </button>
              ))}
            </>
          )}
          {presets.length === 0 && watchlists.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-400 text-center">No lists available</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Saved Watchlists panel ───────────────────────────────────────────────────

function WatchlistPanel() {
  const { watchlists, loadPreset, deleteWatchlist } = useScreenerStore();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (watchlists.length === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Saved Watchlists</div>
      <div className="flex flex-col gap-1.5">
        {watchlists.map((w) => (
          <div key={w.id} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
              <button
                onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
              >
                <ChevronDown
                  size={13}
                  className={`text-slate-400 shrink-0 transition-transform ${expanded === w.id ? "rotate-180" : ""}`}
                />
                <span className="text-sm font-semibold text-slate-700 truncate">{w.name}</span>
                <span className="text-xs text-slate-400 shrink-0">{w.symbols.length} stocks</span>
              </button>
              <button
                onClick={() => loadPreset(w.symbols)}
                className="text-xs px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors font-medium shrink-0"
              >
                Load
              </button>
              <button
                onClick={() => deleteWatchlist(w.id)}
                className="text-slate-300 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
            {expanded === w.id && (
              <div className="px-3 py-2 bg-white border-t border-slate-100">
                {w.symbols.length === 0 ? (
                  <span className="text-xs text-slate-400">No stocks in this watchlist</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {w.symbols.map((sym) => (
                      <span key={sym}
                        className="inline-flex items-center px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-full">
                        {sym}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Save Watchlist inline form ──────────────────────────────────────────────

function SaveWatchlistForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { saveWatchlist } = useScreenerStore();

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await saveWatchlist(trimmed);
      setSaved(true);
      setName("");
      setTimeout(() => { setSaved(false); onSaved(); }, 1500);
    } catch {}
    finally { setSaving(false); }
  };

  if (saved) return (
    <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
      <CheckCircle2 size={14} /> Saved!
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Watchlist name…"
        className="bg-slate-100 text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 border border-transparent focus:border-blue-300 w-44"
      />
      <button onClick={save} disabled={saving || !name.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-40 transition-colors">
        <BookmarkPlus size={13} /> {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

const CANDLE_OPTIONS = [
  { days: 30,  label: "30 days" },
  { days: 90,  label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 252, label: "1 Year" },
];

export default function Screener() {
  const navigate = useNavigate();
  const [showSaveForm, setShowSaveForm] = useState(false);
  const store = useScreenerStore();
  const {
    pickedSymbols, candleDays,
    syncStatus, syncPct, syncDone, syncTotal, syncCurrentSymbol,
    results, loading, error,
    addSymbol, removeSymbol, clearSymbols,
    setCandleDays, startSync,
    loadWatchlists, deleteWatchlist,
  } = store;

  useEffect(() => {
    store.loadPresets();
    store.loadWatchlists();
    store.loadSavedScreeners();
  }, []);

  const prevSyncStatus = useRef(syncStatus);
  useEffect(() => {
    if (prevSyncStatus.current === "running" && syncStatus === "complete") {
      store.runScreen();
    }
    prevSyncStatus.current = syncStatus;
  }, [syncStatus]);

  const canSync  = pickedSymbols.length > 0 && syncStatus !== "running";
  const canScreen = pickedSymbols.length > 0;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Section 1: Stock Picker ── */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">1</div>
          <span className="text-sm font-semibold text-slate-700">Pick Stocks</span>
          <span className="text-xs text-slate-400 ml-1">— search symbols or load a preset list</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex-1 min-w-52">
            <SymbolSearch onAdd={addSymbol} />
          </div>
          <LoadPresetMenu />
          {pickedSymbols.length > 0 && (
            <button onClick={clearSymbols}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1">
              Clear all
            </button>
          )}
        </div>

        {pickedSymbols.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {pickedSymbols.map((sym) => (
              <span key={sym}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold rounded-full">
                {sym}
                <button onClick={() => removeSymbol(sym)} className="hover:text-red-500 transition-colors ml-0.5">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">
            No stocks selected — search above or load a preset list
          </div>
        )}

        {pickedSymbols.length > 0 && (
          <div className="mt-2 text-xs text-slate-500">
            {pickedSymbols.length} stock{pickedSymbols.length !== 1 ? "s" : ""} selected
          </div>
        )}

        <WatchlistPanel />
      </section>

      {/* ── Section 2: Fetch Data ── */}
      <section className={`bg-white border rounded-xl shadow-sm p-4 transition-opacity ${pickedSymbols.length === 0 ? "opacity-40 pointer-events-none" : ""} ${syncStatus === "complete" ? "border-emerald-200" : "border-slate-200"}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0 ${syncStatus === "complete" ? "bg-emerald-500" : "bg-blue-500"}`}>2</div>
          <span className="text-sm font-semibold text-slate-700">Fetch Data</span>
          <span className="text-xs text-slate-400 ml-1">— downloads only missing candles per stock</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {CANDLE_OPTIONS.map((o) => (
              <button key={o.days} onClick={() => setCandleDays(o.days)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${candleDays === o.days ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {o.label}
              </button>
            ))}
          </div>

          <button onClick={startSync} disabled={!canSync}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-40 transition-colors font-medium">
            <RefreshCw size={13} className={syncStatus === "running" ? "animate-spin" : ""} />
            {syncStatus === "running"
              ? `Syncing… ${syncDone}/${syncTotal}`
              : syncStatus === "complete"
              ? "Re-sync"
              : `Fetch Data for ${pickedSymbols.length} stock${pickedSymbols.length !== 1 ? "s" : ""}`}
          </button>

          {syncStatus === "complete" && (
            <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
              <CheckCircle2 size={14} /> Data ready
            </div>
          )}
          {syncStatus === "error" && (
            <div className="flex items-center gap-1.5 text-red-500 text-sm">
              <AlertCircle size={14} /> Sync failed — try again
            </div>
          )}
        </div>

        {syncStatus === "running" && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>{syncCurrentSymbol ? `Syncing ${syncCurrentSymbol}…` : "Preparing…"}</span>
              <span>{syncDone} / {syncTotal} — {syncPct}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(1, syncPct)}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Section 3: Screen & Results ── */}
      <section className={`transition-opacity ${!canScreen ? "opacity-40 pointer-events-none" : ""}`}>
        <div className="flex gap-4">

          {/* Filters panel */}
          <aside className="w-64 shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm p-4 self-start">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">3</div>
              <span className="text-sm font-semibold text-slate-700">Screen</span>
            </div>
            <ScreenerFilters />
          </aside>

          {/* Results */}
          <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">
                  {loading ? "Screening…" : results.length > 0 ? `${results.length} result${results.length !== 1 ? "s" : ""}` : "Results"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {results.length > 0 && !showSaveForm && (
                  <button onClick={() => setShowSaveForm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors font-medium">
                    <BookmarkPlus size={12} /> Save as Watchlist
                  </button>
                )}
                {showSaveForm && (
                  <div className="flex items-center gap-2">
                    <SaveWatchlistForm onSaved={() => { setShowSaveForm(false); loadWatchlists(); }} />
                    <button onClick={() => setShowSaveForm(false)} className="text-slate-400 hover:text-slate-600">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <div className="p-8 flex flex-col items-center gap-3">
                <div className="w-7 h-7 border-[3px] border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                <div className="text-sm text-slate-400">Running screen…</div>
              </div>
            ) : error ? (
              <div className="p-8 text-center text-sm text-red-500">{error}</div>
            ) : results.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">
                {syncStatus === "complete"
                  ? "Add filters on the left and click Run Screen"
                  : "Fetch data in Step 2, then add filters and run the screen"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100 bg-slate-50 sticky top-0">
                      {["Symbol", "Close", "RSI", "SMA50%", "P/E", "D/E", "Promoter%", "FII%", "Delivery%"].map((h) => (
                        <th key={h} className={`py-2 px-3 font-semibold ${h === "Symbol" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const sma50pct = r.close != null && r.sma_50 != null && r.sma_50 > 0
                        ? ((r.close / r.sma_50 - 1) * 100)
                        : null;
                      return (
                        <tr key={r.symbol}
                          onClick={() => navigate(`/stock/${r.symbol}`)}
                          className="border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer transition-colors">
                          <td className="py-2 px-3 text-blue-600 font-semibold">{r.symbol}</td>
                          <td className="py-2 px-3 text-right text-slate-700">₹{fmt(r.close)}</td>
                          <td className={`py-2 px-3 text-right font-medium ${r.rsi_14 != null ? (r.rsi_14 < 30 ? "text-emerald-600" : r.rsi_14 > 70 ? "text-red-500" : "text-slate-700") : "text-slate-400"}`}>
                            {r.rsi_14 != null ? r.rsi_14.toFixed(1) : "—"}
                          </td>
                          <td className={`py-2 px-3 text-right font-medium ${sma50pct != null ? (sma50pct >= 0 ? "text-emerald-600" : "text-red-500") : "text-slate-400"}`}>
                            {sma50pct != null ? pct(sma50pct) : "—"}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">{r.pe_ratio != null ? r.pe_ratio.toFixed(1) : "—"}</td>
                          <td className="py-2 px-3 text-right text-slate-700">{r.debt_to_equity != null ? r.debt_to_equity.toFixed(2) : "—"}</td>
                          <td className="py-2 px-3 text-right text-slate-700">{r.promoter_pct != null ? `${r.promoter_pct.toFixed(1)}%` : "—"}</td>
                          <td className="py-2 px-3 text-right text-slate-700">{r.fii_pct != null ? `${r.fii_pct.toFixed(1)}%` : "—"}</td>
                          <td className="py-2 px-3 text-right text-slate-700">{r.delivery_pct != null ? `${r.delivery_pct.toFixed(1)}%` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </section>

    </div>
  );
}
