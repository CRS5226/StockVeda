import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import SymbolCombobox from "../components/SymbolCombobox";
import { connectionsPath } from "../lib/connections";

const EXAMPLES = ["RELIANCE", "TCS", "TATASTEEL", "HDFCBANK", "NTPC"];

/**
 * Old address of the Connections page. With a symbol it forwards to that stock's Connections view
 * (so old links keep working); without one it is a search box until the Stocks landing page exists.
 */
export default function Connections() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  if (symbol) return <Navigate to={connectionsPath(symbol.toUpperCase())} replace />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Stock connections</h1>
        <div className="w-72">
          <SymbolCombobox value={draft} onChange={setDraft} onSelect={(s) => navigate(connectionsPath(s))} placeholder="Search a stock…" />
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
        <p>Pick a stock to see which stocks move with it, where it sits between raw material and end use, who owns it, where it is based and what it has announced.</p>
        <p className="mt-3 text-slate-500">Try{" "}
          {EXAMPLES.map((s, i) => <span key={s}>{i > 0 && ", "}<Link to={connectionsPath(s)} className="text-blue-600 hover:underline">{s}</Link></span>)}
        </p>
      </div>
    </div>
  );
}
