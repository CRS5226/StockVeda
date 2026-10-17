import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api";
import BacktestChart, { NO_SMC, type SmcToggles } from "./BacktestChart";
import SymbolCombobox from "./SymbolCombobox";

type OhlcvRow = { date: string; open: number; high: number; low: number; close: number };

const RANGES = [
  { label: "6M", days: 183 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1096 },
  { label: "All", days: 0 },
] as const;

interface Concept {
  key: keyof SmcToggles;
  label: string;
  hint: string;
  legend: { color: string; text: string }[];
}

// Grouped as in issue #79; each concept toggles independently.
const GROUPS: { title: string; concepts: Concept[] }[] = [
  {
    title: "Structure",
    concepts: [
      {
        key: "bos", label: "BOS", hint: "break of structure — body close beyond the confirmed HH / LL",
        legend: [
          { color: "bg-emerald-600", text: "BOS · bullish — closes above the HH, up-trend continues" },
          { color: "bg-red-600", text: "BOS · bearish — closes below the LL, down-trend continues" },
        ],
      },
      {
        key: "choch", label: "ChoCH", hint: "change of character — body close beyond the protected HL / LH",
        legend: [{ color: "bg-amber-500", text: "ChoCH — closes through the protected HL / LH, the trend flips" }],
      },
      {
        key: "idm", label: "IDM", hint: "inducement — nearest swing left of a high/low; taking it confirms the HH / LL",
        legend: [{ color: "bg-fuchsia-500", text: "IDM — inducement swing, drawn to the bar that took it" }],
      },
      {
        key: "points", label: "HH / HL / LH / LL", hint: "structure points, shown only once confirmed (HH/LL by IDM, HL/LH by BOS)",
        legend: [
          { color: "bg-green-700", text: "HH · HL — up-trend points" },
          { color: "bg-red-700", text: "LH · LL — down-trend points" },
        ],
      },
    ],
  },
  {
    title: "Blocks",
    concepts: [
      {
        key: "orderBlocks", label: "Order blocks", hint: "last opposing candle before an impulse",
        legend: [
          { color: "bg-emerald-600", text: "Bullish OB (green zone)" },
          { color: "bg-red-600", text: "Bearish OB (red zone)" },
        ],
      },
      {
        key: "blocks", label: "Breaker / Reclaimed / Mitigation", hint: "what price did when it revisited an order block",
        legend: [
          { color: "bg-orange-500", text: "BRK — breaker (block failed, now flips)" },
          { color: "bg-lime-600", text: "RCL — reclaimed (block held after a break)" },
          { color: "bg-slate-500", text: "MIT — mitigation (block absorbed price)" },
        ],
      },
    ],
  },
  {
    title: "Liquidity & imbalance",
    concepts: [
      {
        key: "liquidity", label: "Liquidity", hint: "equal highs/lows and sweeps",
        legend: [{ color: "bg-cyan-500", text: "EQH / EQL — equal highs / lows · SWEEP — liquidity grab" }],
      },
      {
        key: "fvg", label: "FVG", hint: "fair value gap",
        legend: [
          { color: "bg-blue-500", text: "Bullish FVG" },
          { color: "bg-purple-500", text: "Bearish FVG" },
        ],
      },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.concepts.map((c) => c.key));

export default function SmcPanel() {
  const [symbol, setSymbol] = useState("");
  const [loaded, setLoaded] = useState("");
  const [rangeDays, setRangeDays] = useState<number>(365);
  const [ohlcv, setOhlcv] = useState<OhlcvRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [smc, setSmc] = useState<SmcToggles>({ ...NO_SMC, bos: true, choch: true, idm: true });

  const load = async (sym: string, days: number) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setLoading(true);
    setError("");
    try {
      const from = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : undefined;
      const candles = await api.getCandles(s, from);
      if (!candles.length) throw new Error(`No candle data for ${s}`);
      setOhlcv(candles.map(({ date, open, high, low, close }) => ({ date, open, high, low, close })));
      setLoaded(s);
    } catch (e) {
      setOhlcv([]);
      setLoaded("");
      setError(e instanceof Error ? e.message : "Failed to load candles");
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch when the range changes for an already-loaded stock.
  useEffect(() => {
    if (loaded) load(loaded, rangeDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDays]);

  const toggle = (key: keyof SmcToggles) => setSmc((prev) => ({ ...prev, [key]: !prev[key] }));
  const setAll = (on: boolean) => setSmc(Object.fromEntries(ALL_KEYS.map((k) => [k, on])) as unknown as SmcToggles);
  const activeLegends = GROUPS.flatMap((g) => g.concepts).filter((c) => smc[c.key]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-slate-700">SMC — Smart Money Concepts</span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Chart overlays only — no signals or trades. Pick a stock, then switch each concept on or off.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-64">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">Stock</div>
          <SymbolCombobox value={symbol} onChange={setSymbol} placeholder="Search symbol…" />
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">Range</div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r.label} onClick={() => setRangeDays(r.days)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  rangeDays === r.days ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => load(symbol, rangeDays)} disabled={!symbol.trim() || loading}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {loading ? "Loading…" : "Show chart"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={14} className="shrink-0" />{error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        {GROUPS.map((g) => (
          <div key={g.title} className="border border-slate-100 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2">{g.title}</div>
            <div className="flex flex-col gap-2">
              {g.concepts.map((c) => (
                <label key={c.key} className="flex items-start gap-2 cursor-pointer select-none" title={c.hint}>
                  <input type="checkbox" checked={smc[c.key]} onChange={() => toggle(c.key)} className="w-3.5 h-3.5 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-slate-700 leading-tight">{c.label}</span>
                    <span className="block text-[10px] text-slate-400 leading-tight">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 text-xs mb-3">
        <button onClick={() => setAll(true)} className="text-blue-600 hover:underline">Select all</button>
        <button onClick={() => setAll(false)} className="text-slate-500 hover:underline">Clear</button>
      </div>

      {ohlcv.length > 0 ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-50 border-b border-slate-100">{loaded}</div>
          <BacktestChart symbol={loaded} ohlcv={ohlcv} smc={smc} />
          {activeLegends.length > 0 && (
            <div className="flex gap-x-4 gap-y-1 px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex-wrap">
              {activeLegends.flatMap((c) => c.legend).map((l) => (
                <span key={l.text} className="flex items-center gap-1">
                  <span className={`inline-block w-4 h-1 rounded-full ${l.color}`} />{l.text}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        !loading && !error && (
          <div className="text-center text-xs text-slate-400 py-12 border border-dashed border-slate-200 rounded-lg">
            Search for a stock and press “Show chart”.
          </div>
        )
      )}
    </section>
  );
}
