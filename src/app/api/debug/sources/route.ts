import { NextRequest, NextResponse } from "next/server";
import { metaApiFetchQuote, metaApiFetchTimeSeries, isMetaApiPriceStale } from "@/lib/server/metaApiData";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { diagnoseFeeds, getRelevantNews } from "@/lib/server/news";
import { getMacroContext } from "@/lib/server/macroData";

// Diagnostica di TUTTE le fonti dati, senza toccare il database.
// Serve per capire cosa risponde e cosa no anche quando Neon e' sospeso.
// Il test OpenAI e' l'unico a costare credito: e' protetto dal CRON_SECRET
// (?ai=<CRON_SECRET>) per evitare che chiunque possa farlo partire.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Esito = { stato: "ok" | "vuoto" | "errore"; durataMs: number; [k: string]: unknown };

async function timed(fn: () => Promise<Record<string, unknown> | null>): Promise<Esito> {
  const inizio = Date.now();
  try {
    const res = await fn();
    return { stato: res === null ? "vuoto" : "ok", durataMs: Date.now() - inizio, ...(res ?? {}) };
  } catch (err) {
    return {
      stato: "errore",
      durataMs: Date.now() - inizio,
      errore: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<{ http: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text.slice(0, 300);
    try {
      body = JSON.parse(text);
    } catch {
      /* lascia il testo troncato */
    }
    return { http: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const configurate = {
    METAAPI_TOKEN: Boolean(process.env.METAAPI_TOKEN),
    METAAPI_ACCOUNT_ID: Boolean(process.env.METAAPI_ACCOUNT_ID),
    METAAPI_REGION: Boolean(process.env.METAAPI_REGION),
    METAAPI_SYMBOL_XAUUSD: Boolean(process.env.METAAPI_SYMBOL_XAUUSD),
    TWELVE_DATA_API_KEY: Boolean(process.env.TWELVE_DATA_API_KEY),
    FINNHUB_API_KEY: Boolean(process.env.FINNHUB_API_KEY),
    FRED_API_KEY: Boolean(process.env.FRED_API_KEY),
    EODHD_API_KEY: Boolean(process.env.EODHD_API_KEY),
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
  };

  const metaapi = timed(async () => {
    const quote = await metaApiFetchQuote();
    if (!quote) return null;
    const candele = await metaApiFetchTimeSeries("5min", 5);
    return {
      simbolo: process.env.METAAPI_SYMBOL_XAUUSD || "XAUUSD (default)",
      prezzo: Number(quote.close.toFixed(3)),
      quotatoIl: quote.quotedAt ? new Date(quote.quotedAt).toISOString() : null,
      etaSecondi: quote.quotedAt ? Math.round((Date.now() - quote.quotedAt) / 1000) : null,
      prezzoVecchio: isMetaApiPriceStale(quote.quotedAt),
      candele5m: candele ? candele.length : 0,
      ultimaCandela: candele?.[0]?.datetime ?? null,
    };
  });

  const twelvedata = timed(async () => {
    if (!process.env.TWELVE_DATA_API_KEY) return null;
    const { http, body } = await fetchJson(
      `https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const b = body as { close?: string; status?: string; message?: string };
    return {
      http,
      prezzo: b?.close ? Number(b.close) : null,
      messaggio: b?.status === "error" ? b?.message ?? null : null,
    };
  });

  const finnhub = timed(async () => {
    const eventi = await getEconomicCalendar();
    return {
      eventi: eventi.length,
      altoImpatto: eventi.filter((e) => e.impact === "high").length,
      prossimi: eventi.slice(0, 3).map((e) => `${e.time} ${e.impact} ${e.title}`),
    };
  });

  const notizie = timed(async () => {
    const [news, feed] = await Promise.all([getRelevantNews(), diagnoseFeeds()]);
    return {
      totale: news.length,
      feedOk: feed.filter((f) => f.stato === "ok").length,
      feedTotali: feed.length,
      feedRotti: feed.filter((f) => f.stato !== "ok").map((f) => `${f.area}: ${f.stato}`),
    };
  });

  const macro = timed(async () => {
    const m = await getMacroContext();
    return {
      dxy: { valore: m.dxy.value, fonte: m.dxy.source, etaMinuti: m.dxy.ageMinutes },
      us10y: { valore: m.us10y.value, fonte: m.us10y.source, etaMinuti: m.us10y.ageMinutes },
    };
  });

  const eodhd = timed(async () => {
    const key = process.env.EODHD_API_KEY;
    if (!key) return null;
    const candidati = ["DXY.INDX", "DX-Y.NYB", "US10Y.GBOND", "TNX.INDX"];
    const tentativi = [];
    for (const ticker of candidati) {
      try {
        const { http, body } = await fetchJson(
          `https://eodhd.com/api/real-time/${encodeURIComponent(ticker)}?api_token=${key}&fmt=json`,
          6000
        );
        const b = body as { close?: number | string };
        const valore = b?.close !== undefined && b.close !== "NA" ? Number(b.close) : null;
        tentativi.push({ ticker, http, valore: Number.isFinite(valore as number) ? valore : null });
      } catch (err) {
        tentativi.push({ ticker, http: 0, errore: err instanceof Error ? err.message : String(err) });
      }
    }
    return { tentativi };
  });

  const secret = process.env.CRON_SECRET;
  const chiedeAi = req.nextUrl.searchParams.get("ai");
  const aiAutorizzato = Boolean(secret) && chiedeAi === secret;

  const openaiModel = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";

  const openai = aiAutorizzato
    ? timed(async () => {
        if (!process.env.OPENAI_API_KEY) return null;
        const inizio = Date.now();
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: 'Rispondi solo con {"ok":true}.' },
              { role: "user", content: "ping" },
            ],
          }),
        });
        const text = await res.text();
        return {
          http: res.status,
          modello: openaiModel,
          latenzaMs: Date.now() - inizio,
          risposta: res.ok ? text.slice(0, 200) : undefined,
          errore: res.ok ? undefined : text.slice(0, 300),
        };
      })
    : Promise.resolve({
        stato: "saltato" as const,
        durataMs: 0,
        nota: "Test OpenAI non eseguito: aggiungi ?ai=<CRON_SECRET> per lanciarlo (costa una chiamata).",
      });

  const [
    esitoMetaapi,
    esitoTwelve,
    esitoFinnhub,
    esitoNotizie,
    esitoMacro,
    esitoEodhd,
    esitoOpenai,
  ] = await Promise.all([metaapi, twelvedata, finnhub, notizie, macro, eodhd, openai]);

  return NextResponse.json({
    ok: true,
    adesso: new Date().toISOString(),
    configurate,
    fonti: {
      metaapi: esitoMetaapi,
      twelvedata: esitoTwelve,
      finnhub: esitoFinnhub,
      notizie: esitoNotizie,
      macro: esitoMacro,
      eodhd: esitoEodhd,
      openai: esitoOpenai,
    },
  });
}
