import { Banknote, Coins, Landmark, LayoutDashboard, PiggyBank, TrendingUp, type LucideIcon } from "lucide-react";

export type PortfolioTab = "overview" | "stocks" | "mutual_funds" | "dividends" | "fixed_deposits" | "other";

const TABS: { key: PortfolioTab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "stocks", label: "Stocks", icon: TrendingUp },
  { key: "mutual_funds", label: "Mutual Funds", icon: PiggyBank },
  { key: "dividends", label: "Dividends", icon: Coins },
  { key: "fixed_deposits", label: "Fixed Deposits", icon: Landmark },
  { key: "other", label: "Other Investments", icon: Banknote },
];

const STORAGE_KEY = "stockveda.portfolio.tab";

/** The tab the user last had open (the Overview when there is none or storage is unavailable). */
export function loadPortfolioTab(): PortfolioTab {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return TABS.some((t) => t.key === saved) ? (saved as PortfolioTab) : "overview";
  } catch {
    return "overview";
  }
}

export function savePortfolioTab(tab: PortfolioTab): void {
  try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* the choice just won't be remembered */ }
}

/** Tab bar in the style of the navbar links: one tab per kind of investment. */
export default function PortfolioTabs({ value, onChange }: { value: PortfolioTab; onChange: (tab: PortfolioTab) => void }) {
  return (
    <nav className="flex gap-1 text-sm font-medium whitespace-nowrap overflow-x-auto [scrollbar-width:none] border-b border-slate-200 pb-2" aria-label="Portfolio sections">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => onChange(key)} aria-current={value === key ? "page" : undefined}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
            value === key ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}>
          <Icon size={14} />
          {label}
        </button>
      ))}
    </nav>
  );
}
