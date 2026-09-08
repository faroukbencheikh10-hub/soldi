import { metaApiFetchTimeSeries, metaApiFetchQuote } from "@/lib/server/metaApiData";
import { tdFetchTimeSeries, tdFetchQuote, type Candle } from "@/lib/server/marketDataFns";
import { getMacroContext } from "@/lib/server/macroData";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { getRelevantNews } from "@/lib/server/news";
import { getMarketCalendarContext } from "@/lib/server/marketCalendar";
import { computeATR } from "@/lib/server/atr";
import type { CandleNum, LivelliChiave } from "./types";
import { weekStartUtc } from "./week";

function toNum(c: Candle): CandleNum | null {
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return { open, high, low, close, datetime: c.datetime };
}

function closedOnly(candles: CandleNum[], intervalMs: number, now = Date.now()): CandleNum[] {
  return candles.filter((c) => {
    const t = new Date(c.datetime).getTime();
    return Number.isFinite(t) && t + intervalMs <= now;
  });
}

async function fetchSeries(interval: string, size: number): Promise<CandleNum[]> {
  let raw: Candle[] | null = null;
  try {
    raw = await metaApiFetchTimeSeries(interval, size);
  } catch {
    raw = null;
  }
  if (!raw || raw.length === 0) {
    raw = await tdFetchTimeSeries("XAU/USD", interval, size);
  }
  if (!raw) return [];
  const nums = raw.map(toNum).filter((c): c is CandleNum => c !== null);
  nums.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  return nums;
}

const INTERVAL_MS: Record<string, number> = {
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1day": 24 * 60 * 60_000,
  "1week": 7 * 24 * 60 * 60_000,
};

export async function getCandeleChiuse(
  interval: "5min" | "15min" | "1h" | "4h" | "1day" | "1week",
  size: number
): Promise<CandleNum[]> {
  let series: CandleNum[];
  if (interval === "1week") {
    const raw = await tdFetchTimeSeries("XAU/USD", "1week", size);
    series = (raw ?? []).map(toNum).filter((c): c is CandleNum => c !== null);
    series.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  } else {
    series = await fetchSeries(interval, size);
  }
  return closedOnly(series, INTERVAL_MS[interval] ?? 0);
}

export async function getPrezzoXau(): Promise<{ price: number; quotedAt: number | null } | null> {
  try {
    const q = await metaApiFetchQuote();
    if (q && Number.isFinite(q.close)) return { price: q.close, quotedAt: q.quotedAt };
  } catch {
    /* fallback TD */
  }
  const td = await tdFetchQuote("XAU/USD");
  if (td && Number.isFinite(td.close)) return { price: td.close, quotedAt: td.quotedAt };
  return null;
}

export function livelliDaCandele(
  weekly: CandleNum[],
  daily: CandleNum[],
  now = new Date()
): LivelliChiave {
  const start = weekStartUtc(now).getTime();
  const thisWeekDaily = daily.filter((c) => new Date(c.datetime).getTime() >= start);
  const prevWeek = weekly[1] ?? null;
  const ieriClosed = daily[0] ?? null;
  const apertura =
    thisWeekDaily.length > 0
      ? thisWeekDaily[thisWeekDaily.length - 1]?.open ?? null
      : daily[0]?.open ?? null;

  return {
    highSettimanaScorsa: prevWeek?.high ?? null,
    lowSettimanaScorsa: prevWeek?.low ?? null,
    aperturaSettimanale: apertura ?? null,
    highIeri: ieriClosed?.high ?? null,
    lowIeri: ieriClosed?.low ?? null,
  };
}

export async function getContestoSettimana() {
  const [weekly, daily, h4, h1, m15, m5, macro, news, calCtx] = await Promise.all([
    getCandeleChiuse("1week", 20),
    getCandeleChiuse("1day", 30),
    getCandeleChiuse("4h", 60),
    getCandeleChiuse("1h", 60),
    getCandeleChiuse("15min", 20),
    getCandeleChiuse("5min", 200),
    getMacroContext(),
    getRelevantNews(20),
    getMarketCalendarContext(),
  ]);

  let calendar = await getEconomicCalendar();
  const weekEnd = new Date(weekStartUtc().getTime() + 5 * 86_400_000);
  calendar = calendar.filter((e) => {
    const t = new Date(e.time).getTime();
    return Number.isFinite(t) && t <= weekEnd.getTime() && (e.impact === "high" || e.impact === "High");
  });

  const livelli = livelliDaCandele(weekly, daily);
  const atrH1 = computeATR(
    h1.map((c) => ({
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
      datetime: c.datetime,
    })),
    14
  );

  const usaHoliday = calCtx?.new_york?.today?.holidayName ?? null;

  return {
    weekly,
    daily,
    h4,
    h1,
    m15,
    m5,
    macro,
    news,
    calendar,
    livelli,
    atrH1,
    liquiditaRidotta: Boolean(usaHoliday),
    festivoUsa: usaHoliday,
  };
}

export function compactCandles(c: CandleNum[], n: number) {
  return c.slice(0, n).map((x) => ({
    t: x.datetime,
    o: x.open,
    h: x.high,
    l: x.low,
    c: x.close,
  }));
}
