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

const ZONE_VICINE_PAYLOAD = 3;

function distanzaZona(prezzo: number, z: { top: number; bottom: number }): number {
  const alto = Math.max(Number(z.top), Number(z.bottom));
  const basso = Math.min(Number(z.top), Number(z.bottom));
  if (!Number.isFinite(alto) || !Number.isFinite(basso)) return Number.POSITIVE_INFINITY;
  if (prezzo >= basso && prezzo <= alto) return 0;
  return prezzo > alto ? prezzo - alto : basso - prezzo;
}

function vicine<T extends { top: number; bottom: number }>(zone: T[] | undefined, prezzo: number): T[] {
  if (!Array.isArray(zone)) return [];
  return [...zone].sort((a, b) => distanzaZona(prezzo, a) - distanzaZona(prezzo, b)).slice(0, ZONE_VICINE_PAYLOAD);
}

function candeleChiuse(candele: unknown[] | undefined, quante = 5) {
  if (!Array.isArray(candele)) return [];
  return candele.slice(1, 1 + quante);
}

export interface EventoPayload {
  id: string;
  tipo: string;
  timeframe: string;
  direzione: string;
  livello: number;
  candelaTs: string;
}

export function buildAiPayload({
  marketSnapshot,
  news,
  calendar,
  memoriaMercato,
  eventiAttivi,
  scenario,
  tradeProposto,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
  memoriaMercato: Record<string, unknown>;
  eventiAttivi: EventoPayload[];
  scenario: unknown;
  tradeProposto?: {
    direzione: "BUY" | "SELL";
    entry: number;
    stop_loss: number;
    tp1: number;
    tp2: number;
    rischio_rendimento: number;
    nota?: string;
  } | null;
}) {
  const prezzo = marketSnapshot.xauusd;
  const ob = (v: unknown) => vicine(v as { top: number; bottom: number }[] | undefined, prezzo);
  const alias = new Map<string, string>();
  eventiAttivi.forEach((e, i) => alias.set(e.id, `E${i + 1}`));
  const eventiInChiaro = eventiAttivi.map(
    (e) => `${alias.get(e.id)} = ${e.tipo} ${e.timeframe} ${e.direzione} ${Number(e.livello).toFixed(2)} (${e.candelaTs})`
  );
  const alleggerisci = (tf: Record<string, unknown> | undefined, tieniZone: boolean) => {
    if (!tf) return null;
    const { zoneVicine, eventiAttiviIds, ...resto } = tf as Record<string, unknown> & {
      zoneVicine?: unknown;
      eventiAttiviIds?: string[];
    };
    return {
      ...resto,
      eventi: (eventiAttiviIds ?? []).map((id) => alias.get(id) ?? "?"),
      ...(tieniZone ? { zoneVicine } : {}),
    };
  };
  const memoria = {
    prezzo: memoriaMercato.prezzo,
    aggiornatoIl: memoriaMercato.aggiornatoIl,
    m15: alleggerisci(memoriaMercato.m15 as Record<string, unknown>, false),
    m5: alleggerisci(memoriaMercato.m5 as Record<string, unknown>, false),
    liquidita24h: memoriaMercato.liquidita24h,
    eventiInvalidati: memoriaMercato.eventiInvalidati,
  };
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
    sessione_corrente: marketSnapshot.session?.sessione ?? "sconosciuta",
    minuti_da_apertura_londra: marketSnapshot.session?.minutiDaAperturaLondra ?? null,
    minuti_da_apertura_new_york: marketSnapshot.session?.minutiDaAperturaNewYork ?? null,
    finestra_apertura_volatile: marketSnapshot.session?.finestraAperturaVolatile ?? false,
    market_calendar_context: buildCompactCalendarContext(
      marketSnapshot.marketCalendar ?? getMarketCalendarContext()
    ),
    rigetto_5m: marketSnapshot.rigetto5m ?? null,
    rigetto_15m: marketSnapshot.rigetto15m ?? null,
    livelli: marketSnapshot.levels ?? null,
    livelli_5m: marketSnapshot.levels5m ?? null,
    liquidita_24h: marketSnapshot.liquidita24h ?? null,
    ict_bias: marketSnapshot.ictBias ?? "laterale",
    bias_d1: marketSnapshot.biasD1 ?? "sconosciuto",
    bias_h4: marketSnapshot.biasH4 ?? "sconosciuto",
    h4_conferma: marketSnapshot.h4Conferma ?? "sconosciuto",
    dailyRange: marketSnapshot.dailyRange ?? null,
    sintesi_d1_h4: {
      bias_d1: marketSnapshot.biasD1 ?? "sconosciuto",
      bias_h4: marketSnapshot.biasH4 ?? "sconosciuto",
    },
    livelli_apertura: marketSnapshot.livelliApertura ?? null,
    ote_m15: marketSnapshot.oteM15 ?? null,
    kill_zone: marketSnapshot.killZone ?? null,
    judas_swing: marketSnapshot.judasSwing ?? null,
    ict_struttura_h4: marketSnapshot.ictStrutturaH4 ?? null,
    ict_order_block_h4: ob(marketSnapshot.ictOrderBlocksH4),
    ict_fvg_h4: ob(marketSnapshot.ictFvgH4),
    ict_livelli_uguali_h4: marketSnapshot.ictLivelliUgualiH4 ?? null,
    ict_struttura_h1: marketSnapshot.ictStrutturaH1 ?? null,
    ict_order_block_h1: ob(marketSnapshot.ictOrderBlocksH1),
    ict_fvg_h1: ob(marketSnapshot.ictFvgH1),
    ict_livelli_uguali_h1: marketSnapshot.ictLivelliUgualiH1 ?? null,
    ict_struttura_m15: marketSnapshot.ictStrutturaM15 ?? null,
    ict_order_block_m15: ob(marketSnapshot.ictOrderBlocksM15),
    ict_fvg_m15: ob(marketSnapshot.ictFvgM15),
    ict_livelli_uguali_m15: marketSnapshot.ictLivelliUgualiM15 ?? null,
    ict_struttura_5m: marketSnapshot.ictStrutturaM5 ?? null,
    ict_order_block_5m: ob(marketSnapshot.ictOrderBlocksM5),
    ict_fvg_5m: ob(marketSnapshot.ictFvgM5),
    memoria_mercato: memoria,
    eventi_attivi: eventiInChiaro,
    scenario,
    candele_chiuse_recenti: {
      m15: candeleChiuse(marketSnapshot.candles?.["15m"]),
      m5: candeleChiuse(marketSnapshot.candles?.["5m"]),
    },
    news_rilevanti: news,
    calendario_economico: calendar,
    trade_proposto: tradeProposto ?? null,
  };
}

const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";

async function callOpenAI(systemPrompt: string, userPayload: unknown) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI errore ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Risposta OpenAI vuota");
  return content;
}

const SCENARIO_PROMPT = `Sei un analista macro specializzato su XAUUSD (oro). Ricevi un evento economico IMMINENTE, il contesto di mercato attuale e le notizie recenti.\n\nNON devi prevedere il valore che uscira'. Il consenso e' gia' noto e gia' prezzato.\nDevi produrre una MAPPA DI REAZIONE: tre rami condizionali.\nRispondi SOLO con JSON: evento, consenso, ramo_sopra, ramo_sotto, ramo_in_linea, avvertenza, confidenza_mappa.`;

export async function generaScenarioNotizia({
  evento,
  marketSnapshot,
  news,
}: {
  evento: { title: string; country: string; impact: string; time: string };
  marketSnapshot: MarketSnapshot;
  news: unknown;
}) {
  const payload = {
    evento,
    contesto: {
      xauusd: marketSnapshot.xauusd,
      variazione_pct: marketSnapshot.xauusdChangePct ?? null,
      dxy: marketSnapshot.dxy ?? null,
      dxy_variazione_pct: marketSnapshot.dxyChangePct ?? null,
      us10y: marketSnapshot.us10y ?? null,
      us10y_variazione_pct: marketSnapshot.us10yChangePct ?? null,
      atr_15m: marketSnapshot.atr15m ?? null,
      bias_d1: marketSnapshot.biasD1 ?? null,
      bias_h4: marketSnapshot.biasH4 ?? null,
      liquidita_24h: marketSnapshot.liquidita24h ?? null,
    },
    notizie_recenti: news,
  };
  const content = await callOpenAI(SCENARIO_PROMPT, payload);
  return JSON.parse(content);
}

export async function generateSignalDaPayload(userPayload: unknown) {
  const content = await callOpenAI(SYSTEM_PROMPT, userPayload);
  const parsed = JSON.parse(content);
  const bias = (userPayload as { bias_d1?: string } | null)?.bias_d1;
  return filtraSegnaleSulDaily(parsed, bias);
}

export async function generateSignal({
  marketSnapshot,
  news,
  calendar,
  memoriaMercato,
  eventiAttivi,
  scenario,
  tradeProposto,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
  memoriaMercato?: Record<string, unknown>;
  eventiAttivi?: EventoPayload[];
  scenario?: unknown;
  tradeProposto?: {
    direzione: "BUY" | "SELL";
    entry: number;
    stop_loss: number;
    tp1: number;
    tp2: number;
    rischio_rendimento: number;
    nota?: string;
  } | null;
}) {
  const userPayload = buildAiPayload({
    marketSnapshot,
    news,
    calendar,
    memoriaMercato: memoriaMercato ?? {},
    eventiAttivi: eventiAttivi ?? [],
    scenario: scenario ?? null,
    tradeProposto: tradeProposto ?? null,
  });
  const content = await callOpenAI(SYSTEM_PROMPT, userPayload);
  const parsed = filtraSegnaleSulDaily(JSON.parse(content), marketSnapshot.biasD1);
  return { ...parsed, marketSnapshot };
}

export async function generateSignal5m({
  marketSnapshot,
  news,
  calendar,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
}) {
  const userPayload = buildUserPayload({ marketSnapshot, news, calendar });
  const content = await callOpenAI(SYSTEM_PROMPT_5M, userPayload);
  const parsed = filtraSegnaleSulDaily(JSON.parse(content), marketSnapshot.biasD1);
  return { ...parsed, marketSnapshot };
}
