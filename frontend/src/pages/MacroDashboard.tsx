import { useEffect, useState } from "react";
import { api, type MacroRow, type CurrencyRow, type FiiDiiRow } from "../lib/api";
import MacroLineChart from "../components/MacroLineChart";

interface IndexOhlcv { date: string; close: number }

export default function MacroDashboard() {
  const [indices, setIndices] = useState<Record<string, IndexOhlcv[]>>({});
  const [fiiDii, setFiiDii] = useState<FiiDiiRow[]>([]);
  const [currency, setCurrency] = useState<CurrencyRow[]>([]);
  const [macro, setMacro] = useState<MacroRow[]>([]);
  const [macroMetrics, setMacroMetrics] = useState<string[]>([]);

  useEffect(() => {
    api.getIndexList()
      .then((list) => {
        return Promise.all(list.slice(0, 4).map((idx: string) =>
          api.getIndices(idx, threeYearsAgo()).then((data) => [idx, data] as const)
        ));
      })
      .then((pairs) => setIndices(Object.fromEntries(pairs)))
      .catch(() => {});

    api.getFiiDii(ninetyDaysAgo()).then(setFiiDii).catch(() => {});

    api.getCurrency(undefined, threeYearsAgo()).then(setCurrency).catch(() => {});

    api.getMacroMetrics().then(({ monthly, quarterly }) => {
      const all = [...monthly, ...quarterly];
      setMacroMetrics(all);
      return Promise.all(all.slice(0, 4).map((m) =>
        api.getMacroData(m).catch(() => [] as MacroRow[])
      ));
    }).then((all) => setMacro(all.flat())).catch(() => {});
  }, []);

  const indexColors = ["#60a5fa", "#34d399", "#f59e0b", "#a78bfa", "#f87171", "#fb923c"];

  // Group currency by pair
  const pairs = Array.from(new Set(currency.map((c) => c.pair)));

  // Group macro by metric
  const macroByMetric = macroMetrics.reduce((acc, m) => {
    acc[m] = macro.filter((d) => d.metric === m);
    return acc;
  }, {} as Record<string, MacroRow[]>);

  return (
    <div className="flex flex-col gap-6">
      {/* Indices */}
      <section>
        <div className="text-sm font-semibold text-gray-300 mb-3">Market Indices</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(indices).map(([idx, data], i) => (
            <div key={idx} className="bg-gray-900 border border-gray-800 rounded p-3">
              <MacroLineChart title={idx} height={180}
                series={[{ label: idx, color: indexColors[i % indexColors.length], data: data.map((d) => ({ date: d.date, value: d.close })) }]} />
            </div>
          ))}
          {Object.keys(indices).length === 0 && (
            <div className="col-span-2 p-6 text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded">
              No index data — run indices sync first.
            </div>
          )}
        </div>
      </section>

      {/* FII / DII */}
      <section>
        <div className="text-sm font-semibold text-gray-300 mb-3">FII / DII Flows (last 90 days)</div>
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          {fiiDii.length === 0 ? (
            <div className="p-4 text-gray-500 text-sm">No FII/DII data — run sync_fii_dii first.</div>
          ) : (
            <MacroLineChart title="" height={220}
              series={[
                { label: "FII Net", color: "#60a5fa", data: fiiDii.map((d) => ({ date: d.date, value: d.fii_net })) },
                { label: "DII Net", color: "#34d399", data: fiiDii.map((d) => ({ date: d.date, value: d.dii_net })) },
              ]} />
          )}
        </div>
      </section>

      {/* Currency */}
      <section>
        <div className="text-sm font-semibold text-gray-300 mb-3">Currency (vs INR)</div>
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          {currency.length === 0 ? (
            <div className="p-4 text-gray-500 text-sm">No currency data — run sync_currency first.</div>
          ) : (
            <MacroLineChart title="" height={220}
              series={pairs.map((p, i) => ({
                label: p.replace("=X", ""),
                color: indexColors[i % indexColors.length],
                data: currency.filter((c) => c.pair === p).map((c) => ({ date: c.date, value: c.close })),
              }))} />
          )}
        </div>
      </section>

      {/* Macro */}
      <section>
        <div className="text-sm font-semibold text-gray-300 mb-3">Macro Indicators</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {macroMetrics.slice(0, 4).map((m, i) => {
            const data = macroByMetric[m] ?? [];
            return (
              <div key={m} className="bg-gray-900 border border-gray-800 rounded p-3">
                {data.length === 0 ? (
                  <div className="text-gray-500 text-xs p-2">{m} — no data (FRED sync needed, runs on local machine)</div>
                ) : (
                  <MacroLineChart title={m} height={180}
                    series={[{ label: m, color: indexColors[i % indexColors.length], data: data.map((d) => ({ date: d.date, value: d.value })) }]} />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function threeYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}
function ninetyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}
