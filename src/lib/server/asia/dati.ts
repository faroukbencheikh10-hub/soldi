import { metaApiFetchTimeSeries, metaApiFetchQuote } from "@/lib/server/metaApiData";
import { tdFetchTimeSeries, tdFetchQuote, type Candle } from "@/lib/server/marketDataFns";
import type { CandleNum } from "./types";

function toNum(c: Candle): CandleNum | null {
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return { open, high, low, close, datetime: c.datetime };
}

/** datetime = open della candela in UTC. Chiusa se open + durata <= now. */
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
  "1min": 60_000,
  "5min": 5 * 60_000,
};

export async function getCandeleChiuse(
  interval: "1min" | "5min",
  size: number,
  now = Date.now()
): Promise<CandleNum[]> {
  const series = await fetchSeries(interval, size);
  return closedOnly(series, INTERVAL_MS[interval] ?? 0, now);
}

export async function getPrezzoXau(): Promise<{
  price: number;
  bid: number;
  quotedAt: number | null;
} | null> {
  try {
    const q = await metaApiFetchQuote();
    if (q && Number.isFinite(q.close)) {
      const bid = Number.isFinite(q.bid) ? q.bid : q.close;
      return { price: q.close, bid, quotedAt: q.quotedAt };
    }
  } catch {
    /* fallback TD */
  }
  const td = await tdFetchQuote("XAU/USD");
  if (td && Number.isFinite(td.close)) {
    return { price: td.close, bid: td.close, quotedAt: td.quotedAt };
  }
  return null;
}

export function candeleNelFinestra(
  candles: CandleNum[],
  da: Date,
  a: Date
): CandleNum[] {
  const t0 = da.getTime();
  const t1 = a.getTime();
  return candles.filter((c) => {
    const t = new Date(c.datetime).getTime();
    return Number.isFinite(t) && t >= t0 && t < t1;
  });
}
