import { SYSTEM_PROMPT, SYSTEM_PROMPT_5M } from "@/lib/server/agentPrompt";
import { filtraSegnaleSulDaily } from "@/lib/server/filtroDaily";
import {
  buildCompactCalendarContext,
  getMarketCalendarContext,
  type MarketCalendarContext,
} from "@/lib/server/marketCalendar";

interface MarketSnapshot {
  xauusd: number;
  xauusdChangePct: number;
  dxy: number | null;
  dxyChangePct: number | null;
  us10y: number | null;
  us10yChangePct: number | null;
  candles: Record<string, unknown[]>;
  atr15m?: number | null;
  atr1h?: number | null;
  atr5m?: number | null;
  atr30m?: number | null;
  levels?: unknown;
  levels5m?: unknown;
  levels30m?: unknown;
  session?: { sessione: string; minutiDaAperturaLondra: number | null; minutiDaAperturaNewYork: number | null; finestraAperturaVolatile: boolean };
  marketCalendar?: MarketCalendarContext;
  rigetto5m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  rigetto15m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  rigetto30m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  liquidita24h?: { massimo: number; minimo: number } | null;
  dxySource?: string;
  dxyAgeMinutes?: number | null;
  us10ySource?: string;
  us10yAgeMinutes?: number | null;
  ictBias?: string;
  biasD1?: string;
  biasH4?: string;
  h4Conferma?: string;
  dailyRange?: { high: number; low: number } | null;
  livelliApertura?: unknown;
  oteM15?: unknown;
  killZone?: unknown;
  judasSwing?: unknown;
  ictStrutturaH4?: unknown;
  ictOrderBlocksH4?: unknown;
  ictFvgH4?: unknown;
  ictLivelliUgualiH4?: unknown;
  ictStrutturaH1?: unknown;
  ictOrderBlocksH1?: unknown;
  ictFvgH1?: unknown;
  ictLivelliUgualiH1?: unknown;
  ictStrutturaM15?: unknown;
  ictOrderBlocksM15?: unknown;
  ictFvgM15?: unknown;
  ictLivelliUgualiM15?: unknown;
  ictStrutturaM30?: unknown;
  ictOrderBlocksM30?: unknown;
  ictFvgM30?: unknown;
  ictLivelliUgualiM30?: unknown;
  ictStrutturaM5?: unknown;
  ictOrderBlocksM5?: unknown;
  ictFvgM5?: unknown;
}

export function buildUserPayload({
  marketSnapshot,
  news,
  calendar,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
}) {
  return {
    prezzo_attuale_xauusd: marketSnapshot.xauusd,
    variazione_pct_xauusd: marketSnapshot.xauusdChangePct,
    dxy: marketSnapshot.dxy,
    dxy_variazione_pct: marketSnapshot.dxyChangePct,
    us10y: marketSnapshot.us10y,
    us10y_variazione_pct: marketSnapshot.us10yChangePct,
    dxy_fonte: marketSnapshot.dxySource ?? "sconosciuta",
    dxy_eta_minuti: marketSnapshot.dxyAgeMinutes ?? null,
    us10y_fonte: marketSnapshot.us10ySource ?? "sconosciuta",
    us10y_eta_minuti: marketSnapshot.us10yAgeMinutes ?? null,
    atr_15m: marketSnapshot.atr15m ?? null,
    atr_1h: marketSnapshot.atr1h ?? null,
    atr_5m: marketSnapshot.atr5m ?? null,
    atr_30m: marketSnapshot.atr30m ?? null,
    livelli: marketSnapshot.levels ?? null,
    livelli_5m: marketSnapshot.levels5m ?? null,
    livelli_30m: marketSnapshot.levels30m ?? null,
    sessione_corrente: marketSnapshot.session?.sessione ?? "sconosciuta",
    minuti_da_apertura_londra: marketSnapshot.session?.minutiDaAperturaLondra ?? null,
    minuti_da_apertura_new_york: marketSnapshot.session?.minutiDaAperturaNewYork ?? null,
    finestra_apertura_volatile: marketSnapshot.session?.finestraAperturaVolatile ?? false,
    rigetto_5m: marketSnapshot.rigetto5m ?? null,
    rigetto_30m: marketSnapshot.rigetto30m ?? null,
    liquidita_24h: marketSnapshot.liquidita24h ?? null,
    ict_bias: marketSnapshot.ictBias ?? "laterale",
    bias_d1: marketSnapshot.biasD1 ?? "sconosciuto",
    bias_h4: marketSnapshot.biasH4 ?? "sconosciuto",
    dailyRange: marketSnapshot.dailyRange ?? null,
    ict_struttura_m30: marketSnapshot.ictStrutturaM30 ?? null,
    ict_order_block_m30: marketSnapshot.ictOrderBlocksM30 ?? [],
    ict_fvg_m30: marketSnapshot.ictFvgM30 ?? [],
    ict_livelli_uguali_m30: marketSnapshot.ictLivelliUgualiM30 ?? null,
    ict_struttura_5m: marketSnapshot.ictStrutturaM5 ?? null,
    ict_order_block_5m: marketSnapshot.ictOrderBlocksM5 ?? [],
    ict_fvg_5m: marketSnapshot.ictFvgM5 ?? [],
    candele_5m_recenti: marketSnapshot.candles["5m"]?.slice(0, 20),
    candele_15m_recenti: marketSnapshot.candles["15m"]?.slice(0, 20),
    candele_30m_recenti: marketSnapshot.candles["30m"]?.slice(0, 20),
    candele_1h_recenti: marketSnapshot.candles["1h"]?.slice(0, 20),
    candele_4h_recenti: marketSnapshot.candles["4h"]?.slice(0, 20),
    news_rilevanti: news,
    calendario_economico: calendar,
  };
}
