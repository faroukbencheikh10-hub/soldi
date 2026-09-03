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
  riskReward: number;
  confidence: number;
  reasoning: string;
  outcome?: SignalOutcome;
  resultR?: number;
  /** Istante in cui il prezzo ha toccato l'entry e il trade e' diventato
   * vivo. Nullo finche' il segnale e' solo un ordine limite in attesa.
   * Serve alla dashboard per distinguere i due stati: senza, un setup
   * appena generato sembra identico a un trade gia' in corso. */
  attivatoIl?: string | null;
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
