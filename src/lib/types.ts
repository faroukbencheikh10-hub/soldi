export type ConnectionStatus = "live" | "disconnected" | "error";

export interface MarketQuote {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
  status: ConnectionStatus;
  ageMinutes?: number | null;
}

export type SignalDirection = "BUY" | "SELL" | "NO_TRADE";
export type SignalOutcome = "WIN" | "LOSS" | "OPEN" | "BREAKEVEN";

export interface TradeSignal {
  id: string;
  createdAt: string;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  // Puramente informativo (canale normale): dove spostare lo stop SE TP1
  // viene gia' raggiunto e il trade resta aperto verso TP2 (es. breakeven).
  // Non influenza in alcun modo come l'app chiude i trade.
  stopLossTp2?: number | null;
  riskReward: number;
  confidence: number;
  reasoning: string;
  outcome?: SignalOutcome;
  resultR?: number;
  isDemo: boolean;
}

export interface EconomicEvent {
  id: string;
  time: string;
  country: string;
  title: string;
  impact: "low" | "medium" | "high";
}

export interface NewsItem {
  id: string;
  time: string;
  source: string;
  title: string;
  tag: "financial" | "geopolitical" | "trump";
  area?: "asia" | "globale";
}

export interface PerformanceStats {
  totalSignals: number;
  winRate: number | null;
  avgRR: number | null;
  bestCondition: string | null;
}
