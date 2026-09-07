import {
  metaApiFetchQuote,
  metaApiFetchTimeSeries,
  isMetaApiPriceStale,
} from "@/lib/server/metaApiData";
import { tdFetchQuote, tdFetchTimeSeries } from "@/lib/server/marketDataFns";
import { costruisciSnapshot } from "@/lib/server/marketDataBuild";
import { memorizzaBiasIct } from "@/lib/server/ictDirezione";
import type { MarketSnapshot } from "@/lib/server/marketData";

async function tryMetaApi(): Promise<MarketSnapshot | null> {
  const xau = await metaApiFetchQuote();
  if (!xau || isMetaApiPriceStale(xau.quotedAt)) {
    console.error("[marketDataSnap] MetaApi quote assente o stantia");
    return null;
  }
  const [c5, c15, c30, c1h, c4h, c1d] = await Promise.all([
    metaApiFetchTimeSeries("5min", 40),
    metaApiFetchTimeSeries("15min", 40),
    metaApiFetchTimeSeries("30min", 40),
    metaApiFetchTimeSeries("1h", 40),
    metaApiFetchTimeSeries("4h", 40),
    metaApiFetchTimeSeries("1day", 30),
  ]);
  if (!c5 || !c15 || !c1h) {
    console.error("[marketDataSnap] MetaApi candele insufficienti", {
      c5: !!c5,
      c15: !!c15,
      c1h: !!c1h,
    });
    return null;
  }
  return costruisciSnapshot({
    xau,
    c5,
    c15,
    c30,
    c1h,
    c4h,
    c1d,
    source: "metaapi",
  });
}

async function tryTwelveData(): Promise<MarketSnapshot | null> {
  const xau = await tdFetchQuote("XAU/USD");
  if (!xau) {
    console.error("[marketDataSnap] Twelve Data quote assente");
    return null;
  }
  const [c5, c15, c30, c1h, c4h, c1d] = await Promise.all([
    tdFetchTimeSeries("XAU/USD", "5min", 40),
    tdFetchTimeSeries("XAU/USD", "15min", 40),
    tdFetchTimeSeries("XAU/USD", "30min", 40),
    tdFetchTimeSeries("XAU/USD", "1h", 40),
    tdFetchTimeSeries("XAU/USD", "4h", 40),
    tdFetchTimeSeries("XAU/USD", "1day", 30),
  ]);
  if (!c5 || !c15 || !c1h) {
    console.error("[marketDataSnap] Twelve Data candele insufficienti", {
      c5: !!c5,
      c15: !!c15,
      c1h: !!c1h,
    });
    return null;
  }
  return costruisciSnapshot({
    xau,
    c5,
    c15,
    c30,
    c1h,
    c4h,
    c1d,
    source: "twelvedata",
  });
}

export async function getCurrentPrice(): Promise<number | null> {
  const metaQuote = await metaApiFetchQuote();
  if (metaQuote && !isMetaApiPriceStale(metaQuote.quotedAt)) return metaQuote.close;
  const tdQuote = await tdFetchQuote("XAU/USD");
  return tdQuote ? tdQuote.close : null;
}

export async function getMarketSnapshot() {
  const meta = await tryMetaApi();
  if (meta) {
    memorizzaBiasIct(meta.biasD1, meta.biasH4, meta.h4Conferma);
    return { ...meta, fetchedAt: new Date().toISOString() };
  }
  const td = await tryTwelveData();
  if (td) {
    memorizzaBiasIct(td.biasD1, td.biasH4, td.h4Conferma);
    return { ...td, fetchedAt: new Date().toISOString() };
  }
  throw new Error("Impossibile recuperare dati di mercato: MetaApi e Twelve Data entrambi falliti");
}
