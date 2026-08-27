import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/server/marketData";
import { metaApiFetchTimeSeries, metaApiFetchQuote } from "@/lib/server/metaApiData";

const TD_BASE = "https://api.twelvedata.com";

// Interroga Twelve Data due volte: come lo interrogava il codice vecchio
// (senza timezone, default "Exchange") e come lo interroga adesso
// (timezone=UTC). La differenza fra le due colonne e' la prova di dove
// nasceva lo sfasamento, senza sottrarre ore a mano da nessuna parte.
async function twelveData(conUtc: boolean): Promise<string[] | null> {
  try {
    const url =
      `${TD_BASE}/time_series?symbol=${encodeURIComponent("XAU/USD")}&interval=5min&outputsize=3` +
      (conUtc ? "&timezone=UTC" : "") +
      `&apikey=${process.env.TWELVE_DATA_API_KEY}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "error" || !Array.isArray(data.values)) return null;
    return (data.values as Array<{ datetime: string }>).map((v) => v.datetime);
  } catch {
    return null;
  }
}

// Diagnostica degli orari: mostra la stringa GREZZA che arriva da ciascuna
// fonte accanto a come viene interpretata, e lo scarto rispetto all'orologio.
// Serve a capire dove nasce lo sfasamento prima di scrivere qualsiasi
// conversione -- niente "-10 ore" a occhio.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function analizza(grezzo: string | undefined, adesso: number) {
  if (!grezzo) return null;
  const interpretato = new Date(grezzo);
  const ms = interpretato.getTime();
  return {
    grezzo,
    haOffsetEsplicito: /[zZ]$|[+-]\d{2}:?\d{2}$/.test(grezzo.trim()),
    interpretatoComeUtc: Number.isFinite(ms) ? interpretato.toISOString() : "non interpretabile",
    scartoMinuti: Number.isFinite(ms) ? Math.round((ms - adesso) / 60000) : null,
  };
}

export async function GET() {
  try {
    const adesso = Date.now();
    const [snapshot, candeleMeta, quoteMeta, tdSenza, tdConUtc] = await Promise.all([
      getMarketSnapshot(),
      metaApiFetchTimeSeries("5min", 3).catch(() => null),
      metaApiFetchQuote().catch(() => null),
      twelveData(false),
      twelveData(true),
    ]);

    return NextResponse.json({
      ok: true,
      adessoUtc: new Date(adesso).toISOString(),
      fonteSnapshot: snapshot.source,
      nota:
        "scartoMinuti positivo = la candela risulta nel futuro. Con dati corretti l'ultima candela chiusa deve avere scarto negativo, pari al piu' alla durata del timeframe.",
      metaapiDiretto: {
        quote: quoteMeta?.quotedAt
          ? { quotedAtUtc: new Date(quoteMeta.quotedAt).toISOString(), scartoMinuti: Math.round((quoteMeta.quotedAt - adesso) / 60000) }
          : null,
        candele5m: (candeleMeta ?? []).map((c) => analizza(c.datetime, adesso)),
      },
      twelvedata: {
        nota:
          "senzaTimezone = come chiedevamo prima (default Exchange). conTimezoneUtc = come chiediamo adesso. Lo scarto fra le due e' l'offset del fuso dell'exchange, che non dobbiamo piu' indovinare noi.",
        senzaTimezone: (tdSenza ?? []).map((d) => analizza(`${d.replace(" ", "T")}Z`, adesso)),
        conTimezoneUtc: (tdConUtc ?? []).map((d) => analizza(`${d.replace(" ", "T")}Z`, adesso)),
      },
      snapshotInUso: {
        candele5m: (snapshot.candles["5m"] ?? []).slice(0, 3).map((c) => analizza(c.datetime, adesso)),
        candele30m: (snapshot.candles["30m"] ?? []).slice(0, 2).map((c) => analizza(c.datetime, adesso)),
        candele1h: (snapshot.candles["1h"] ?? []).slice(0, 2).map((c) => analizza(c.datetime, adesso)),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
