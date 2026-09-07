import { getMacroContext } from "@/lib/server/macroData";
import { computeATR } from "@/lib/server/atr";
import {
  calcolaLivelliApertura,
  killZoneCorrente,
  rilevaJudasSwing,
  oteDaSwing,
  type Ote,
  type LivelliApertura,
  type ContestoKillZone,
  type JudasSwing,
} from "@/lib/server/ictOriginale";
import { computeLevels, type Levels } from "@/lib/server/levels";
import { computeLevels5m, type Levels5m } from "@/lib/server/levels5m";
import { computeLevels30m, type Levels30m } from "@/lib/server/levels30m";
import { computeRejection, type RejectionSignal } from "@/lib/server/rejection";
import {
  computeStructure,
  computeSwings,
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

type BiasVerso = "rialzista" | "ribassista" | "laterale";
export type H4Conferma = "allineato" | "contrario" | "laterale" | "sconosciuto";

/** Daily decide la direzione. H4 conferma o segnala pullback. Non votano alla pari. */
export function componiBiasIct(biasD1: string, biasH4: string): {
  ictBias: "rialzista" | "ribassista" | "laterale" | "in disaccordo";
  h4Conferma: H4Conferma;
} {
  const d1 = biasD1 as BiasVerso;
  const h4 = biasH4 as BiasVerso;
  if (d1 !== "rialzista" && d1 !== "ribassista") {
    return { ictBias: "laterale", h4Conferma: h4 === "rialzista" || h4 === "ribassista" ? "laterale" : "sconosciuto" };
  }
  if (h4 === d1) return { ictBias: d1, h4Conferma: "allineato" };
  if (h4 === "rialzista" || h4 === "ribassista") return { ictBias: d1, h4Conferma: "contrario" };
  return { ictBias: d1, h4Conferma: "laterale" };
}
