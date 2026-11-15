import type { ElementType } from "react";
import { BarChart2, TrendingUp, Users, Building2, Activity, Newspaper } from "lucide-react";

export type Tab = "fundamentals" | "delivery" | "shareholding" | "corp" | "backtest" | "news" | "deals";

export type FundView = "pl" | "bs" | "cf";

export const TABS: { id: Tab; label: string; icon: ElementType }[] = [
  { id: "fundamentals", label: "Fundamentals", icon: BarChart2 },
  { id: "delivery", label: "Delivery", icon: TrendingUp },
  { id: "shareholding", label: "Shareholding", icon: Users },
  { id: "corp", label: "Corp Actions", icon: Building2 },
  { id: "deals", label: "Bulk/Block Deals", icon: Activity },
  { id: "news", label: "News", icon: Newspaper },
];
