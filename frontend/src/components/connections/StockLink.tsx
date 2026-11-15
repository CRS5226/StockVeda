import { Link } from "react-router-dom";

/** A symbol that opens the Connections page for that stock. */
export default function StockLink({ symbol, name }: { symbol: string; name?: string | null }) {
  return (
    <Link to={`/connections/${encodeURIComponent(symbol)}`} title={name ?? symbol}
      className="font-medium text-blue-600 hover:text-blue-800 hover:underline">
      {symbol}
    </Link>
  );
}
