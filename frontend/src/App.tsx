import { Routes, Route } from "react-router-dom";
import Screener from "./pages/Screener";
import StockDetail from "./pages/StockDetail";
import Backtest from "./pages/Backtest";
import MacroDashboard from "./pages/MacroDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Screener />} />
      <Route path="/stock/:symbol" element={<StockDetail />} />
      <Route path="/backtest" element={<Backtest />} />
      <Route path="/macro" element={<MacroDashboard />} />
    </Routes>
  );
}
