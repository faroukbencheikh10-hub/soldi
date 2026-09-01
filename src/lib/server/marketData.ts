import { getMacroContext } from "@/lib/server/macroData";
import { computeATR } from "@/lib/server/atr";
import { computeLevels, type Levels } from "@/lib/server/levels";
import { computeLevels5m, type Levels5m } from "@/lib/server/levels5m";
import { computeLevels30m, type Levels30m } from "@/lib/server/levels30m";
import { computeRejection, type RejectionSignal } from "@/lib/server/rejection";
import {
  computeStructure,
  computeOrderBlocks,
  computeFVG,
  computeEqualLevels,
  type StructureResult,
  type OrderBlock,
  type FVG,
  type LivelliUguali,
} from "@/lib/server/ictStructure";
import {
  metaApiFetchQuote,
  metaApiFetchTimeSeries,
  isMetaApiPriceStale,
} from "@/lib/server/metaApiData";
import {
  getMarketCalendarContext,
  type MarketCalendarContext,
} from "@/lib/server/marketCalendar";

const TD_BASE = "https://api.twelvedata.com";

function newYorkDayAndHour(date: Date): { day: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourText = parts.find((p) => p.type === "hour")?.value ?? "";

    const days: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const day = days[weekday];
    const hour = Number(hourText);
    if (day === undefined || !Number.isFinite(hour)) return null;

    return { day, hour };
  } catch {
    return null;
  }
}

export function isMarketOpen(date: Date = new Date()): boolean {
  const ny = newYorkDayAndHour(date);

  if (ny === null) return true;

  if (ny.day === 6) return false;
  if (ny.day === 0) return ny.hour >= 18;
  if (ny.day === 5) return ny.hour < 17;
  return ny.hour !== 17;
}

function minutesSinceMidnight(date: Date, timeZone: string): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);

    const days: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const day = days[weekday];
    if (day === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    return { day, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

export interface SessionInfo {
  sessione: "asia" | "londra" | "new_york" | "londra_new_york" | "chiuso";
  minutiDaAperturaLondra: number | null;
  minutiDaAperturaNewYork: number | null;
  finestraAperturaVolatile: boolean;
}

const LONDON_OPEN_MIN = 8 * 60;
const LONDON_CLOSE_MIN = 16 * 60 + 30;
const NY_OPEN_MIN = 9 * 60 + 30;
const NY_CLOSE_MIN = 16 * 60;
const FINESTRA_VOLATILE_MIN = 45;

function computeLiquidity24h(candles1h: Candle[] | undefined): { massimo: number; minimo: number } | null {
  if (!Array.isArray(candles1h) || candles1h.length < 24) return null;
  const finestra = candles1h.slice(0, 24);
  const massimi = finestra.map((c) => Number(c.high)).filter(Number.isFinite);
  const minimi = finestra.map((c) => Number(c.low)).filter(Number.isFinite);
  if (massimi.length === 0 || minimi.length === 0) return null;
  return { massimo: Number(Math.max(...massimi).toFixed(2)), minimo: Number(Math.min(...minimi).toFixed(2)) };
}

/**
 * Sessione corrente e minuti dall'apertura.
 *
 * La finestra oraria resta quella di sempre (Londra 08:00-16:30, New York
 * 09:30-16:00), ma una sessione conta solo se quel mercato risulta realmente
 * OPEN in quel momento. Cosi' un lunedi' festivo non risulta piu' "londra".
 * Nient'altro cambia: il fallback resta "asia" come prima.
 */
export function computeSessionInfo(
  date: Date = new Date(),
  calendario: MarketCalendarContext = getMarketCalendarContext(date)
): SessionInfo {
  const london = minutesSinceMidnight(date, "Europe/London");
  const ny = minutesSinceMidnight(date, "America/New_York");

  const londonOpen =
    calendario.london.today.status === "open" &&
    london !== null && london.day >= 1 && london.day <= 5 &&
    london.minutes >= LONDON_OPEN_MIN && london.minutes < LONDON_CLOSE_MIN;
  const nyOpen =
    calendario.new_york.today.status === "open" &&
    ny !== null && ny.day >= 1 && ny.day <= 5 &&
    ny.minutes >= NY_OPEN_MIN && ny.minutes < NY_CLOSE_MIN;

  let sessione: SessionInfo["sessione"];
  if (londonOpen && nyOpen) sessione = "londra_new_york";
  else if (londonOpen) sessione = "londra";
  else if (nyOpen) sessione = "new_york";
  else sessione = "asia";

  const minutiDaAperturaLondra = londonOpen && london !== null ? london.minutes - LONDON_OPEN_MIN : null;
  const minutiDaAperturaNewYork = nyOpen && ny !== null ? ny.minutes - NY_OPEN_MIN : null;

  const finestraAperturaVolatile =
    (minutiDaAperturaLondra !== null && minutiDaAperturaLondra < FINESTRA_VOLATILE_MIN) ||
    (minutiDaAperturaNewYork !== null && minutiDaAperturaNewYork < FINESTRA_VOLATILE_MIN);

  return { sessione, minutiDaAperturaLondra, minutiDaAperturaNewYork, finestraAperturaVolatile };
}

interface Candle {
  open: string;
  high: string;
  low: string;
  close: string;
  /**
   * SEMPRE UTC in formato ISO con la "Z" finale. E' l'unico campo temporale
   * che il resto dell'app deve leggere: setup_events, TTL, sessioni, scenari
   * e confronti fra timeframe si basano solo su questo.
   */
  datetime: string;
  /** La stringa esatta ricevuta dal provider, conservata per diagnostica. */
  rawBrokerTime?: string;
  /** Come e' stata interpretata quella stringa. */
  brokerTimezone?: string;
}

/**
 * Scarta le candele che risultano nel futuro. Con dati sani non ne esiste
 * nessuna: l'ultima candela e' quella in formazione, che parte nel passato.
 * Una candela nel futuro significa timestamp non normalizzato, e da li' in
 * poi TTL e invalidazioni degli eventi diventano insensati.
 */
function scartaCandeleNelFuturo(candele: Candle[], etichetta: string): Candle[] {
  const limite = Date.now() + TOLLERANZA_FUTURO_MS;
  const buone = candele.filter((c) => {
    const ms = new Date(c.datetime).getTime();
    return Number.isFinite(ms) && ms <= limite;
  });
  if (buone.length !== candele.length) {
    console.error(
      `[marketData] ${candele.length - buone.length} candele ${etichetta} nel futuro scartate (timestamp non normalizzato)`
    );
  }
  return buone;
}

/** Piccolo margine per lo scarto fra orologio del provider e orologio nostro. */
const TOLLERANZA_FUTURO_MS = 2 * 60 * 1000;

/** Come scartaCandeleNelFuturo, ma tollera l'assenza dell'array. */
function scarta(candele: Candle[] | null, etichetta: string): Candle[] | null {
  return candele ? scartaCandeleNelFuturo(candele, etichetta) : null;
}

/**
 * Twelve Data restituisce "YYYY-MM-DD HH:MM:SS" senza offset. Con
 * &timezone=UTC nella richiesta quella stringa E' gia' UTC, quindi qui basta
 * renderla esplicita aggiungendo la "Z". Non sottraiamo mai un offset a mano:
 * la conversione la fa il provider, noi la rendiamo solo inequivocabile.
 */
function normalizzaCandeleTwelveData(grezze: unknown, etichetta: string): Candle[] | null {
  if (!Array.isArray(grezze)) return null;
  const out: Candle[] = [];
  let scartate = 0;
  for (const c of grezze as Array<Record<string, string>>) {
    const raw = String(c?.datetime ?? "");
    const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) {
      scartate += 1;
      continue;
    }
    out.push({
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
      datetime: new Date(ms).toISOString(),
      rawBrokerTime: raw,
      brokerTimezone: "UTC (richiesto esplicitamente a Twelve Data con timezone=UTC)",
    });
  }
  if (scartate > 0) {
    console.error(`[marketData] ${scartate} candele ${etichetta} Twelve Data con datetime illeggibile`);
  }
  if (out.length === 0) return null;
  return scartaCandeleNelFuturo(out, `${etichetta} (twelvedata)`);
}

export interface MarketSnapshot {
  xauusd: number;
  xauusdChangePct: number;
  xauusdQuotedAt: number | null;
  dxy: number | null;
  dxyChangePct: number | null;
  us10y: number | null;
  us10yChangePct: number | null;
  candles: { "5m": Candle[]; "15m": Candle[]; "30m": Candle[]; "1h": Candle[]; "4h": Candle[] };
  source: "metaapi" | "twelvedata";
  atr15m: number | null;
  atr1h: number | null;
  atr5m: number | null;
  atr30m: number | null;
  levels: Levels;
  levels5m: Levels5m;
  levels30m: Levels30m;
  session: SessionInfo;
  /** Stato odierno dei quattro mercati (aperto/chiuso + festivita'). Contesto, non filtro. */
  marketCalendar: MarketCalendarContext;
  rigetto5m: RejectionSignal;
  rigetto15m: RejectionSignal;
  rigetto30m: RejectionSignal;
  liquidita24h: { massimo: number; minimo: number } | null;
  dxySource: string;
  dxyAgeMinutes: number | null;
  us10ySource: string;
  us10yAgeMinutes: number | null;
  ictBias: "rialzista" | "ribassista" | "laterale" | "in disaccordo";
  biasD1: string;
  biasH4: string;
  ictStrutturaH1: StructureResult;
  ictOrderBlocksH1: OrderBlock[];
  ictFvgH1: FVG[];
  ictLivelliUgualiH1: LivelliUguali;
  ictStrutturaM30: StructureResult;
  ictStrutturaM15: StructureResult;
  ictStrutturaM5: StructureResult;
  ictOrderBlocksM30: OrderBlock[];
  ictFvgM30: FVG[];
  ictLivelliUgualiM30: LivelliUguali;
  ictOrderBlocksM15: OrderBlock[];
  ictFvgM15: FVG[];
  ictLivelliUgualiM15: LivelliUguali;
  ictOrderBlocksM5: OrderBlock[];
  ictFvgM5: FVG[];
}

async function tdFetchQuote(symbol: string): Promise<{ close: number; percent_change: number; quotedAt: number | null } | null> {
  try {
    const url = `${TD_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_API_KEY}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "error" || data.close === undefined || data.close === null) return null;
    const close = Number(data.close);
    if (!Number.isFinite(close)) return null;
    const rawTimestamp = Number(data.timestamp);
    const quotedAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp * 1000 : null;
    return { close, percent_change: Number(data.percent_change) || 0, quotedAt };
  } catch {
    return null;
  }
}

async function tdFetchTimeSeries(symbol: string, interval: string, outputsize = 40): Promise<Candle[] | null> {
  try {
    // timezone=UTC: e' Twelve Data a fare la conversione dal fuso dell'exchange.
    // Senza questo parametro il default e' "Exchange" e le candele arrivavano
    // spostate di circa dieci ore, finendo nel futuro.
    const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(
      symbol
    )}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${process.env.TWELVE_DATA_API_KEY}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "error" || !Array.isArray(data.values)) return null;
    return normalizzaCandeleTwelveData(data.values, interval);
  } catch {
    return null;
  }
}

async function tryTwelveData(): Promise<MarketSnapshot | null> {
  const xau = await tdFetchQuote("XAU/USD");
  if (!xau) return null;

  // Calcolato una volta sola: sessione e contesto calendario devono descrivere
  // lo stesso istante. Funzione pura, nessuna chiamata di rete.
  const adesso = new Date();
  const calendarioMercati = getMarketCalendarContext(adesso);

  const [c5, c15, c30, c1h, c4h, c1d, macro] = await Promise.all([
    tdFetchTimeSeries("XAU/USD", "5min", 40),
    tdFetchTimeSeries("XAU/USD", "15min", 40),
    tdFetchTimeSeries("XAU/USD", "30min", 40),
    tdFetchTimeSeries("XAU/USD", "1h", 40),
    tdFetchTimeSeries("XAU/USD", "4h", 40),
    tdFetchTimeSeries("XAU/USD", "1day", 30),
    getMacroContext(),
  ]);
  if (!c5 || !c15 || !c1h) return null;

  const atr15 = computeATR(c15, 14);
  const atr5 = computeATR(c5, 14);
  const atr30 = c30 ? computeATR(c30, 14) : null;
  const atr1h = computeATR(c1h, 14);

  const biasD1 = c1d ? computeStructure(c1d).bias : "laterale";
  const biasH4 = c4h ? computeStructure(c4h).bias : "laterale";
  let ictBias: MarketSnapshot["ictBias"];
  if (!c1d) ictBias = biasH4;
  else if (biasD1 === "laterale" || biasH4 === "laterale") ictBias = biasD1 !== "laterale" ? biasD1 : biasH4;
  else if (biasD1 === biasH4) ictBias = biasD1;
  else ictBias = "in disaccordo";

  return {
    xauusd: xau.close,
    xauusdChangePct: xau.percent_change,
    xauusdQuotedAt: xau.quotedAt,
    dxy: macro.dxy.value,
    dxyChangePct: macro.dxy.changePct,
    us10y: macro.us10y.value,
    us10yChangePct: macro.us10y.changePct,
    candles: { "5m": c5, "15m": c15, "30m": c30 ?? [], "1h": c1h, "4h": c4h ?? [] },
    source: "twelvedata",
    atr15m: atr15,
    atr1h,
    atr5m: atr5,
    atr30m: atr30,
    levels: computeLevels(c15, xau.close, atr15),
    levels5m: computeLevels5m(c5, xau.close, atr5),
    levels30m: computeLevels30m(c30 ?? undefined, xau.close, atr30),
    session: computeSessionInfo(adesso, calendarioMercati),
    marketCalendar: calendarioMercati,
    rigetto5m: computeRejection(c5, atr5),
    rigetto15m: computeRejection(c15, atr15),
    rigetto30m: computeRejection(c30 ?? undefined, atr30),
    liquidita24h: computeLiquidity24h(c1h ?? undefined),
    dxySource: macro.dxy.source,
    dxyAgeMinutes: macro.dxy.ageMinutes,
    us10ySource: macro.us10y.source,
    us10yAgeMinutes: macro.us10y.ageMinutes,
    biasD1,
    biasH4,
    ictBias,
    ictStrutturaH1: computeStructure(c1h),
    ictOrderBlocksH1: computeOrderBlocks(c1h),
    ictFvgH1: computeFVG(c1h),
    ictLivelliUgualiH1: computeEqualLevels(c1h, atr1h),
    ictStrutturaM30: computeStructure(c30 ?? []),
    ictStrutturaM15: computeStructure(c15),
    ictStrutturaM5: computeStructure(c5),
    ictOrderBlocksM30: computeOrderBlocks(c30 ?? []),
    ictFvgM30: computeFVG(c30 ?? []),
    ictLivelliUgualiM30: computeEqualLevels(c30 ?? [], atr30),
    ictOrderBlocksM15: computeOrderBlocks(c15),
    ictFvgM15: computeFVG(c15),
    ictLivelliUgualiM15: computeEqualLevels(c15, atr15),
    ictOrderBlocksM5: computeOrderBlocks(c5),
    ictFvgM5: computeFVG(c5),
  };
}

async function tryMetaApi(): Promise<MarketSnapshot | null> {
  const xau = await metaApiFetchQuote();
  if (!xau) return null;
  if (isMetaApiPriceStale(xau.quotedAt)) {
    console.error("[marketData] prezzo MetaApi stale, passo al fallback Twelve Data");
    return null;
  }

  // Calcolato una volta sola: sessione e contesto calendario devono descrivere
  // lo stesso istante. Funzione pura, nessuna chiamata di rete.
  const adesso = new Date();
  const calendarioMercati = getMarketCalendarContext(adesso);

  const [c5Raw, c15Raw, c30Raw, c1hRaw, c4hRaw, c1dRaw, macro] = await Promise.all([
    metaApiFetchTimeSeries("5min", 40),
    metaApiFetchTimeSeries("15min", 40),
    metaApiFetchTimeSeries("30min", 40),
    metaApiFetchTimeSeries("1h", 40),
    metaApiFetchTimeSeries("4h", 40),
    metaApiFetchTimeSeries("1day", 30),
    getMacroContext(),
  ]);

  // Rete di sicurezza: anche con MetaApi, se un timestamp arrivasse spostato
  // la candela non deve entrare nel motore. Meglio una candela in meno che un
  // evento datato nel futuro dentro setup_events.
  const c5 = scarta(c5Raw, "metaapi 5m");
  const c15 = scarta(c15Raw, "metaapi 15m");
  const c30 = scarta(c30Raw, "metaapi 30m");
  const c1h = scarta(c1hRaw, "metaapi 1h");
  const c4h = scarta(c4hRaw, "metaapi 4h");
  const c1d = scarta(c1dRaw, "metaapi 1d");

  if (!c5 || !c15 || !c1h) return null;

  const atr15 = computeATR(c15, 14);
  const atr5 = computeATR(c5, 14);
  const atr30 = c30 ? computeATR(c30, 14) : null;
  const atr1h = computeATR(c1h, 14);

  const biasD1 = c1d ? computeStructure(c1d).bias : "laterale";
  const biasH4 = c4h ? computeStructure(c4h).bias : "laterale";
  let ictBias: MarketSnapshot["ictBias"];
  if (!c1d) ictBias = biasH4;
  else if (biasD1 === "laterale" || biasH4 === "laterale") ictBias = biasD1 !== "laterale" ? biasD1 : biasH4;
  else if (biasD1 === biasH4) ictBias = biasD1;
  else ictBias = "in disaccordo";

  const previousDailyClose = c1d && c1d.length > 1 ? Number(c1d[1]?.close) : NaN;
  const xauusdChangePct =
    Number.isFinite(previousDailyClose) && previousDailyClose > 0
      ? Number((((xau.close - previousDailyClose) / previousDailyClose) * 100).toFixed(3))
      : 0;

  return {
    xauusd: xau.close,
    xauusdChangePct,
    xauusdQuotedAt: xau.quotedAt,
    dxy: macro.dxy.value,
    dxyChangePct: macro.dxy.changePct,
    us10y: macro.us10y.value,
    us10yChangePct: macro.us10y.changePct,
    candles: { "5m": c5, "15m": c15, "30m": c30 ?? [], "1h": c1h, "4h": c4h ?? [] },
    source: "metaapi",
    atr15m: atr15,
    atr1h,
    atr5m: atr5,
    atr30m: atr30,
    levels: computeLevels(c15, xau.close, atr15),
    levels5m: computeLevels5m(c5, xau.close, atr5),
    levels30m: computeLevels30m(c30 ?? undefined, xau.close, atr30),
    session: computeSessionInfo(adesso, calendarioMercati),
    marketCalendar: calendarioMercati,
    rigetto5m: computeRejection(c5, atr5),
    rigetto15m: computeRejection(c15, atr15),
    rigetto30m: computeRejection(c30 ?? undefined, atr30),
    liquidita24h: computeLiquidity24h(c1h ?? undefined),
    dxySource: macro.dxy.source,
    dxyAgeMinutes: macro.dxy.ageMinutes,
    us10ySource: macro.us10y.source,
    us10yAgeMinutes: macro.us10y.ageMinutes,
    biasD1,
    biasH4,
    ictBias,
    ictStrutturaH1: computeStructure(c1h),
    ictOrderBlocksH1: computeOrderBlocks(c1h),
    ictFvgH1: computeFVG(c1h),
    ictLivelliUgualiH1: computeEqualLevels(c1h, atr1h),
    ictStrutturaM30: computeStructure(c30 ?? []),
    ictStrutturaM15: computeStructure(c15),
    ictStrutturaM5: computeStructure(c5),
    ictOrderBlocksM30: computeOrderBlocks(c30 ?? []),
    ictFvgM30: computeFVG(c30 ?? []),
    ictLivelliUgualiM30: computeEqualLevels(c30 ?? [], atr30),
    ictOrderBlocksM15: computeOrderBlocks(c15),
    ictFvgM15: computeFVG(c15),
    ictLivelliUgualiM15: computeEqualLevels(c15, atr15),
    ictOrderBlocksM5: computeOrderBlocks(c5),
    ictFvgM5: computeFVG(c5),
  };
}

export async function getCurrentPrice(): Promise<number | null> {
  const metaQuote = await metaApiFetchQuote();
  if (metaQuote && !isMetaApiPriceStale(metaQuote.quotedAt)) {
    return metaQuote.close;
  }

  const tdQuote = await tdFetchQuote("XAU/USD");
  return tdQuote ? tdQuote.close : null;
}

export async function getMarketSnapshot() {
  const primary = await tryMetaApi();
  if (primary) {
    return { ...primary, fetchedAt: new Date().toISOString() };
  }

  console.error("[marketData] MetaApi non disponibile, uso fallback Twelve Data");
  const fallback = await tryTwelveData();
  if (fallback) {
    return { ...fallback, fetchedAt: new Date().toISOString() };
  }

  throw new Error("Impossibile recuperare dati di mercato: MetaApi e Twelve Data entrambi falliti");
}
