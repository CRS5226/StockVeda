import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Screener from "./pages/Screener";
import StockDetail from "./pages/StockDetail";
import Backtest from "./pages/Backtest";
import MacroDashboard from "./pages/MacroDashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-4">
        <Routes>
          <Route path="/" element={<Screener />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/macro" element={<MacroDashboard />} />
        </Routes>
      </main>
    </div>
  );
}
