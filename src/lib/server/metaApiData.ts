const TOKEN = process.env.METAAPI_TOKEN;
const ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;
const SYMBOL = process.env.METAAPI_SYMBOL_XAUUSD || "XAUUSD";

const RAW_REGION = process.env.METAAPI_REGION;

function regionCandidates(): string[] {
  const candidati: string[] = [];
  const raw = RAW_REGION?.trim().toLowerCase();

  if (raw) candidati.push(raw);

  for (const r of ["backup-new-york", "new-york", "london"]) {
    if (!candidati.includes(r)) candidati.push(r);
  }

  return candidati;
}

let regioneConfermata: string | null = null;

function clientApiBase(region: string) {
  return `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
}
function marketDataApiBase(region: string) {
  return `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;
}

function isRegionMismatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    (msg.includes("404") && msg.includes("is not found"))
  );
}

function assertConfigured() {
  if (!TOKEN || !ACCOUNT_ID) {
    throw new Error("MetaApi non configurato: mancano METAAPI_TOKEN / METAAPI_ACCOUNT_ID");
  }
}

async function metaApiGet(url: string, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "auth-token": TOKEN as string },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`MetaApi HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}


async function metaApiGetWithRegion(buildUrl: (region: string) => string): Promise<unknown> {
  const candidati = regioneConfermata ? [regioneConfermata] : regionCandidates();
  let ultimoErrore: unknown = null;

  for (const region of candidati) {
    try {
      const data = await metaApiGet(buildUrl(region));
      if (regioneConfermata !== region) {
        console.log(`[metaApiData] regione MetaApi funzionante: ${region}`);
        regioneConfermata = region;
      }
      return data;
    } catch (err) {
      ultimoErrore = err;
      if (isRegionMismatch(err)) {
        if (regioneConfermata === region) regioneConfermata = null;
        continue;
      }
      throw err;
    }
  }

  throw ultimoErrore ?? new Error("MetaApi: nessuna regione valida trovata");
}

export async function metaApiFetchQuote(symbol: string = SYMBOL): Promise<{
  close: number;
  percent_change: number;
  quotedAt: number | null;
} | null> {
  try {
    assertConfigured();
    const data = (await metaApiGetWithRegion(
      (region) =>
        `${clientApiBase(region)}/users/current/accounts/${ACCOUNT_ID}/symbols/${symbol}/current-price`
    )) as { bid?: number; ask?: number; time?: string };
    if (typeof data.bid !== "number" || typeof data.ask !== "number") return null;

    const close = (data.bid + data.ask) / 2;
    if (!Number.isFinite(close)) return null;

    const quotedAt = data.time ? new Date(data.time).getTime() : null;
    return { close, percent_change: 0, quotedAt: Number.isFinite(quotedAt) ? quotedAt : null };
  } catch (err) {
    console.error(`[metaApiData] prezzo fallito (${symbol}):`, err);
    return null;
  }
}

const TIMEFRAME_MAP: Record<string, string> = {
  "5min": "5m",
  "15min": "15m",
  "30min": "30m",
  "1h": "1h",
  "4h": "4h",
  "1day": "1d",
};

// Una stringa ISO e' inequivocabile solo se porta con se' l'offset: "Z"
// oppure "+hh:mm" / "-hh:mm" in coda.
const HA_OFFSET_ESPLICITO = /(?:Z|[+-]\d{2}:?\d{2})$/;

export async function metaApiFetchTimeSeries(
  interval: string,
  outputsize = 40,
  symbol: string = SYMBOL
): Promise<
  {
    open: string;
    high: string;
    low: string;
    close: string;
    datetime: string;
    rawBrokerTime: string;
    brokerTimezone: string;
  }[] | null
> {
  try {
    assertConfigured();
    const tf = TIMEFRAME_MAP[interval];
    if (!tf) throw new Error(`Timeframe non mappato per MetaApi: ${interval}`);

    const data = (await metaApiGetWithRegion(
      (region) =>
        `${marketDataApiBase(region)}/users/current/accounts/${ACCOUNT_ID}/historical-market-data/symbols/${symbol}/timeframes/${tf}/candles?limit=${outputsize}`
    )) as Array<{
      time: string;
      open: number;
      high: number;
      low: number;
      close: number;
    }>;

    if (!Array.isArray(data) || data.length === 0) return null;

    // Normalizzazione UTC alla fonte. MetaApi restituisce sempre un timestamp
    // ISO con offset esplicito (es. "2026-08-27T00:40:00.000Z"): lo riportiamo
    // a UTC canonico con toISOString(). Se un giorno arrivasse una stringa
    // senza offset la scartiamo invece di interpretarla a caso: meglio una
    // candela in meno che un orario sbagliato che avvelena setup_events.
    const candles: {
      open: string;
      high: string;
      low: string;
      close: string;
      datetime: string;
      rawBrokerTime: string;
      brokerTimezone: string;
    }[] = [];

    let scartateSenzaOffset = 0;
    for (const c of data) {
      const raw = String(c.time ?? "");
      if (!HA_OFFSET_ESPLICITO.test(raw)) {
        scartateSenzaOffset += 1;
        continue;
      }
      const ms = new Date(raw).getTime();
      if (!Number.isFinite(ms)) {
        scartateSenzaOffset += 1;
        continue;
      }
      candles.push({
        open: String(c.open),
        high: String(c.high),
        low: String(c.low),
        close: String(c.close),
        datetime: new Date(ms).toISOString(),
        rawBrokerTime: raw,
        brokerTimezone: "UTC (offset esplicito nella risposta MetaApi)",
      });
    }

    if (scartateSenzaOffset > 0) {
      console.error(
        `[metaApiData] ${scartateSenzaOffset} candele ${interval} scartate: timestamp senza offset esplicito`
      );
    }
    if (candles.length === 0) return null;

    candles.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

    return candles;
  } catch (err) {
    console.error(`[metaApiData] candele ${interval} fallite (${symbol}):`, err);
    return null;
  }
}

export function isMetaApiPriceStale(quotedAt: number | null, maxAgeSeconds = 30): boolean {
  if (quotedAt === null) return true;
  return Date.now() - quotedAt > maxAgeSeconds * 1000;
}
