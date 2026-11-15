import { api } from "../../lib/api";
import type { CompanyProfile, WeatherDay } from "../../lib/connectionsTypes";
import { flagLabel, sectionElementId, shortDate } from "../../lib/connections";
import { useSectionData } from "../../lib/useSectionData";
import SectionCard from "./SectionCard";

const num = (n: number | null, digits = 0) => (n === null ? "–" : n.toFixed(digits));

function Fact({ label, value }: { label: string; value: string | null }) {
  return value ? <div><dt className="text-[11px] text-slate-400">{label}</dt><dd className="text-sm text-slate-800">{value}</dd></div> : null;
}

function Days({ all }: { all: WeatherDay[] }) {
  // The two latest past days for context, then the forecast; older days would only make the table long.
  const past = all.filter((d) => !d.is_forecast).slice(-2);
  const days = [...past, ...all.filter((d) => d.is_forecast)];
  const maxRain = Math.max(1, ...days.map((d) => d.precip_mm ?? 0));
  return (
    <table className="w-full text-xs mt-2">
      <thead><tr className="text-slate-400 text-left">
        <th className="font-normal pb-1">Day</th><th className="font-normal pb-1">Rain</th>
        <th className="font-normal pb-1 text-right">High °C</th><th className="font-normal pb-1 text-right">Gust km/h</th>
      </tr></thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.date} className={`border-t border-slate-100 ${d.is_forecast ? "" : "text-slate-400"}`}>
            <td className="py-1">{shortDate(d.date)}{d.is_forecast ? "" : " (past)"}</td>
            <td className="py-1">
              <span className="inline-block h-1.5 rounded bg-sky-400 align-middle mr-1.5" style={{ width: `${((d.precip_mm ?? 0) / maxRain) * 60}px` }} />
              {num(d.precip_mm, 1)} mm
            </td>
            <td className="py-1 text-right">{num(d.temp_max_c)}</td>
            <td className="py-1 text-right">{num(d.wind_gust_kmh)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Where the company is based, and the weather there with a neutral note on what it can mean for the sector. */
export default function LocationWeatherSection({ symbol, profile }: { symbol: string; profile: CompanyProfile | null }) {
  const w = useSectionData(() => api.getWeather(symbol), [symbol]);
  const where = [profile?.city, profile?.state].filter(Boolean).join(", ");
  const d = w.data;
  return (
    <SectionCard id={sectionElementId("location")} title="Headquarters and weather" loading={false} missing={false} error=""
      subtitle={where || "Location not known yet"} emptyText="">
      {profile ? (
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="City" value={profile.city} /><Fact label="State" value={profile.state} />
          <Fact label="Sector" value={profile.sector} /><Fact label="Industry" value={profile.industry} />
          <Fact label="Pincode" value={profile.pincode} />
          <Fact label="Employees" value={profile.employees ? profile.employees.toLocaleString("en-IN") : null} />
        </dl>
      ) : <p className="text-sm text-slate-500">No company profile yet. Run the company_profile sync.</p>}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Weather at headquarters</h3>
        {w.loading ? <p className="text-sm text-slate-400">Loading…</p>
          : w.error ? <p className="text-sm text-red-600">{w.error}</p>
          : w.missing || !d ? <p className="text-sm text-slate-500">No weather for this city yet. It needs a city, then the weather sync.</p>
          : (
            <>
              {d.summary.flags.length > 0 && (
                <div className="flex gap-1.5 mb-1.5">
                  {d.summary.flags.map((f) => <span key={f} className="text-[11px] bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">{flagLabel(f)} in the next 7 days</span>)}
                </div>
              )}
              {d.sector_note && <p className="text-xs text-slate-600">{d.sector_note}</p>}
              <Days all={d.daily} />
            </>
          )}
        <p className="text-[11px] text-slate-400 mt-2">
          Weather at the headquarters city is a weak signal: plants, mines, farms and customers are often elsewhere. Context only, not a forecast for the stock.
        </p>
      </div>
    </SectionCard>
  );
}
