import { getMarketCalendarContext, type MarketCalendarContext } from "@/lib/server/marketCalendar";
import type { Levels } from "@/lib/server/levels";
import type { Levels5m } from "@/lib/server/levels5m";
import type { Levels30m } from "@/lib/server/levels30m";
import type { RejectionSignal } from "@/lib/server/rejection";
import type {
  StructureResult,
  OrderBlock,
  FVG,
  LivelliUguali,
} from "@/lib/server/ictStructure";
import type {
  Ote,
  LivelliApertura,
  ContestoKillZone,
  JudasSwing,
} from "@/lib/server/ictOriginale";

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

type BiasVerso = "rialzista" | "ribassista" | "laterale";
export type H4Conferma = "allineato" | "contrario" | "laterale" | "sconosciuto";

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

interface Candle {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
  rawBrokerTime?: string;
  brokerTimezone?: string;
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
  h4Conferma: H4Conferma;
  dailyRange: { high: number; low: number } | null;
  livelliApertura: LivelliApertura;
  oteM15: Ote | null;
  killZone: ContestoKillZone;
  judasSwing: JudasSwing;
  ictStrutturaH4: StructureResult;
  ictOrderBlocksH4: OrderBlock[];
  ictFvgH4: FVG[];
  ictLivelliUgualiH4: LivelliUguali;
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

export { getCurrentPrice, getMarketSnapshot } from "@/lib/server/marketDataSnap";
