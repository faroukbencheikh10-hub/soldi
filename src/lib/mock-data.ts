import { MarketQuote, TradeSignal, EconomicEvent, NewsItem, PerformanceStats } from "./types";

export const XAUUSD_QUOTE: MarketQuote = {
  symbol: "XAUUSD",
  label: "Oro / USD",
  price: null,
  changePercent: null,
  status: "disconnected",
};

export const DXY_QUOTE: MarketQuote = {
  symbol: "DXY",
  label: "Dollar Index",
  price: null,
  changePercent: null,
  status: "disconnected",
};

export const US10Y_QUOTE: MarketQuote = {
  symbol: "US10Y",
  label: "US 10Y Yield",
  price: null,
  changePercent: null,
  status: "disconnected",
};

export const ECONOMIC_CALENDAR: EconomicEvent[] = [];
export const NEWS_FEED: NewsItem[] = [];

export const CURRENT_SIGNAL: TradeSignal | null = null;

export const SIGNAL_HISTORY: TradeSignal[] = [
  {
    id: "demo-1",
    createdAt: "2026-08-14T09:32:00Z",
    direction: "BUY",
    entry: 2412.5,
    stopLoss: 2405.0,
    tp1: 2420.0,
    tp2: 2431.0,
    riskReward: 2.4,
    confidence: 78,
    reasoning: "Esempio dimostrativo: breakout sopra resistenza M15 con conferma DXY in calo.",
    outcome: "WIN",
    resultR: 2.4,
    isDemo: true,
  },
  {
    id: "demo-2",
    createdAt: "2026-08-13T14:10:00Z",
    direction: "SELL",
    entry: 2399.8,
    stopLoss: 2406.2,
    tp1: 2392.0,
    tp2: 2384.5,
    riskReward: 1.9,
    confidence: 71,
    reasoning: "Esempio dimostrativo: rigetto su resistenza H1 con divergenza RSI.",
    outcome: "LOSS",
    resultR: -1,
    isDemo: true,
  },
];

export const PERFORMANCE_STATS: PerformanceStats = {
  totalSignals: SIGNAL_HISTORY.length,
  winRate: null,
  avgRR: null,
  bestCondition: null,
};
