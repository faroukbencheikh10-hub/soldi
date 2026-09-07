const TD_BASE = "https://api.twelvedata.com";

export interface Candle {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
  rawBrokerTime?: string;
  brokerTimezone?: string;
}

const TOLLERANZA_FUTURO_MS = 2 * 60 * 1000;

export function scartaCandeleNelFuturo(candele: Candle[], etichetta: string): Candle[] {
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

export function scarta(candele: Candle[] | null, etichetta: string): Candle[] | null {
  return candele ? scartaCandeleNelFuturo(candele, etichetta) : null;
}

export function computeLiquidity24h(candles1h: Candle[] | undefined): { massimo: number; minimo: number } | null {
  if (!Array.isArray(candles1h) || candles1h.length < 24) return null;
  const finestra = candles1h.slice(0, 24);
  const massimi = finestra.map((c) => Number(c.high)).filter(Number.isFinite);
  const minimi = finestra.map((c) => Number(c.low)).filter(Number.isFinite);
  if (massimi.length === 0 || minimi.length === 0) return null;
  return { massimo: Number(Math.max(...massimi).toFixed(2)), minimo: Number(Math.min(...minimi).toFixed(2)) };
}

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

export async function tdFetchQuote(symbol: string): Promise<{ close: number; percent_change: number; quotedAt: number | null } | null> {
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

export async function tdFetchTimeSeries(symbol: string, interval: string, outputsize = 40): Promise<Candle[] | null> {
  try {
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
