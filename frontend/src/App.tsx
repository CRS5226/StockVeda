import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import MarketDashboard from "./pages/MarketDashboard";
import StockDetail from "./pages/StockDetail";
import Screener from "./pages/Screener";
import Backtest from "./pages/Backtest";
import FnO from "./pages/FnO";
import MutualFunds from "./pages/MutualFunds";
import MutualFundDetail from "./pages/MutualFundDetail";
import Charts from "./pages/Charts";

export default function App() {
  // The Charts page is full-screen: no page padding, width cap or footer, just the navbar and the chart.
  const fullScreen = useLocation().pathname.startsWith("/charts");
  return (
    <div className={`bg-slate-50 text-slate-900 flex flex-col ${fullScreen ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      <Navbar />
      <main className={fullScreen ? "flex-1 min-h-0 w-full pt-14" : "flex-1 max-w-[1400px] w-full mx-auto px-4 pt-[72px] pb-6"}>
        <Routes>
          <Route path="/" element={<MarketDashboard />} />
          <Route path="/charts/:symbol?" element={<Charts />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/screener" element={<Screener />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/fno" element={<FnO />} />
          <Route path="/mutual-funds" element={<MutualFunds />} />
          <Route path="/mutual-funds/:schemeCode" element={<MutualFundDetail />} />
          <Route path="/analysis" element={<Navigate to="/backtest" replace />} />
        </Routes>
      </main>
      {!fullScreen && <Footer />}
    </div>
  );
}
