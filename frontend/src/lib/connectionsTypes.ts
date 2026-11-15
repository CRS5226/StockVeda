/** Response types for the Stock Connections endpoints (see backend/routes/connections.py and company_events.py). */

export interface CompanyProfile {
  symbol: string; city: string | null; state: string | null; pincode: string | null;
  sector: string | null; industry: string | null; website: string | null; employees: number | null;
  lat: number | null; lon: number | null; updated_at: string | null;
}

export interface CorrelatedEntry {
  symbol: string; name: string | null; sector: string | null; industry: string | null;
  correlation: number | null; return_1m: number | null; return_3m: number | null; pe: number | null;
}
export interface CorrelatedResponse {
  symbol: string; window: number; as_of: string;
  profile: { sector: string | null; industry: string | null; city: string | null } | null;
  beta_vs_nifty: number | null;
  self: CorrelatedEntry; positive: CorrelatedEntry[]; negative: CorrelatedEntry[]; peers: CorrelatedEntry[];
}

export type FlowRole = "current" | "upstream" | "downstream" | "other";
export interface FlowStock { symbol: string; name: string | null; industry: string | null; return_1m: number | null; return_3m: number | null }
export interface FlowNode { id: string; label: string; role: FlowRole; stocks: FlowStock[] }
export interface FlowChain { id: string; name: string; nodes: FlowNode[]; edges: { from: string; to: string }[] }
export interface FlowResponse { symbol: string; sector: string | null; industry: string | null; chains: FlowChain[]; note: string }

export interface OwnershipNode { id: string; symbol: string | null; listed: boolean; kind: "company" | "holder"; label: string; category?: string }
export interface OwnershipEdge { source: string; target: string; pct: number; as_of: string }
export interface GroupCompany { symbol: string; pct: number; name: string | null }
export interface OwnershipResponse {
  symbol: string; depth: number; as_of: string | null;
  nodes: OwnershipNode[]; edges: OwnershipEdge[];
  group: { holder: string; companies: GroupCompany[] }[]; note: string;
}

export interface WeatherDay { date: string; precip_mm: number | null; temp_max_c: number | null; wind_gust_kmh: number | null; is_forecast: boolean }
export interface WeatherResponse {
  symbol: string; city: string; sector: string | null; industry: string | null;
  daily: WeatherDay[];
  summary: { rain_total_mm: number | null; max_daily_rain_mm: number | null; max_temp_c: number | null; max_gust_kmh: number | null; flags: string[] };
  sector_note: string | null; disclaimer: string;
}

export interface CompanyEvent { event_time: string; category: string; kind: string; subject: string; pdf_url: string | null }
export interface BoardMeeting { meeting_date: string; purpose: string; description: string }
export interface EventsResponse {
  symbol: string; order_wins_12m: number; history_from: string | null;
  next_meeting: BoardMeeting | null; upcoming_meetings: BoardMeeting[]; events: CompanyEvent[];
}
