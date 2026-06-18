import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import MarketDashboard from "./pages/MarketDashboard";
import StockDetail from "./pages/StockDetail";
import Screener from "./pages/Screener";
import Backtest from "./pages/Backtest";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 pt-[72px] pb-6">
        <Routes>
          <Route path="/" element={<MarketDashboard />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/screener" element={<Screener />} />
          <Route path="/backtest" element={<Backtest />} />
        </Routes>
      </main>
    </div>
  );
}
