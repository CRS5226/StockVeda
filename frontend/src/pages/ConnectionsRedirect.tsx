import { Navigate, useParams } from "react-router-dom";
import { connectionsPath } from "../lib/connections";

/** Old addresses of the Connections page: /connections/:symbol opens that stock's Connections view, /connections the Stocks page. */
export default function ConnectionsRedirect() {
  const { symbol } = useParams();
  return <Navigate to={symbol ? connectionsPath(symbol.toUpperCase()) : "/stock"} replace />;
}
