const TOKEN = process.env.METAAPI_TOKEN;
const ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;
const SYMBOL = process.env.METAAPI_SYMBOL_XAUUSD || "XAUUSD";

const RAW_REGION = process.env.METAAPI_REGION;

// Regioni da provare, in ordine.
//
// Se METAAPI_REGION e' impostata si usa SOLO quella. Prima le altre venivano
// aggiunte comunque in coda, e quando la regione buona falliva per un motivo
// qualsiasi (lentezza, errore momentaneo) il codice ripiegava su regioni dove
// l'account NON esiste. MetaApi conta quelle come "richieste verso account
// inesistenti o non attivi nella regione interrogata" e risponde 429: un
// intoppo passeggero si trasformava cosi' in un rate limit, con caduta sul
// fallback Twelve Data.
//
// Senza la variabile impostata resta la ricerca a tentativi, che serve al
// primo avvio per scoprire la regione giusta.
function regionCandidates(): string[] {
  const raw = RAW_REGION?.trim().toLowerCase();
  if (raw) return [raw];

  return ["backup-new-york", "new-york", "london"];
}

let regioneConfermata: string | null = null;

function clientApiBase(region: string) {
  return `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
}
function marketDataApiBase(region: string) {
  return `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;
}

// Errore che indica "questo account non vive in questa regione": ha senso
// provare la regione successiva.
//
// NON include il 429: un rate limit non dice niente sulla regione, dice che
// stiamo chiedendo troppo. Provare un'altra regione mentre si e' limitati
// aggiunge richieste proprio quando MetaApi ne sta gia' rifiutando -- e le
// regioni alternative sono quelle dove l'account non esiste, cioe' esattamente
// le chiamate che hanno fatto scattare il limite. Su 429 si esce subito e si
// lascia lavorare il fallback Twelve Data.
function isRegionMismatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("429")) return false;
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

// Timeout per singola richiesta a MetaApi.
//
// Era 8 secondi, ed era troppo poco: nei log di produzione la maggior parte
// degli errori erano AbortError, cioe' richieste interrotte da NOI mentre la
// risposta stava arrivando -- non rifiuti di MetaApi. Con l'account deployed
// e connesso (full redundancy) quelle erano risposte lente ma valide, buttate
// via per impazienza, con conseguente caduta sul fallback Twelve Data.
//
// 15 secondi restano ampiamente dentro il tetto della funzione serverless
// (maxDuration = 60): le sei richieste per i timeframe partono in parallelo
// con Promise.all, quindi l'attesa peggiore complessiva e' 15 secondi, non
// la loro somma. Il costo si paga solo quando MetaApi e' davvero irraggiungibile.
const METAAPI_TIMEOUT_MS = 15000;

async function metaApiGet(url: string, timeoutMs = METAAPI_TIMEOUT_MS): Promise<unknown> {
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
  // Con una sola candidata non c'e' nessuna "scoperta" da annunciare: e' la
  // regione configurata, e loggarla a ogni avvio a freddo riempiva i log
  // facendo sembrare che la variabile non fosse impostata.
  const daScoprire = candidati.length > 1;
  let ultimoErrore: unknown = null;

  for (const region of candidati) {
    try {
      const data = await metaApiGet(buildUrl(region));
      if (regioneConfermata !== region) {
        if (daScoprire) {
          console.log(`[metaApiData] regione MetaApi trovata per tentativi: ${region} (imposta METAAPI_REGION per evitare la ricerca)`);
        }
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
