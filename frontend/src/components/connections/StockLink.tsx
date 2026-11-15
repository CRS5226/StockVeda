import { Link } from "react-router-dom";
import { connectionsPath } from "../../lib/connections";

/** A symbol that opens the Connections view of that stock's page. */
export default function StockLink({ symbol, name }: { symbol: string; name?: string | null }) {
  return (
    <Link to={connectionsPath(symbol)} title={name ?? symbol}
      className="font-medium text-blue-600 hover:text-blue-800 hover:underline">
      {symbol}
    </Link>
  );
}
