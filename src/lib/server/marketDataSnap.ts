import { getMacroContext } from "@/lib/server/macroData";
import { computeATR } from "@/lib/server/atr";
import {
  calcolaLivelliApertura,
  killZoneCorrente,
  rilevaJudasSwing,
  oteDaSwing,
} from "@/lib/server/ictOriginale";
import { computeLevels } from "@/lib/server/levels";
import { computeLevels5m } from "@/lib/server/levels5m";
import { computeLevels30m } from "@/lib/server/levels30m";
import { computeRejection } from "@/lib/server/rejection";
import {
  computeStructure,
  computeSwings,
  computeOrderBlocks,
  computeFVG,
  computeEqualLevels,
} from "@/lib/server/ictStructure";
import {
  metaApiFetchQuote,
  isMetaApiPriceStale,
} from "@/lib/server/metaApiData";
import { getMarketCalendarContext } from "@/lib/server/marketCalendar";
import {
  computeSessionInfo,
  componiBiasIct,
  type MarketSnapshot,
  type H4Conferma,
} from "@/lib/server/marketData";
import {
  tdFetchQuote,
  tdFetchTimeSeries,
  computeLiquidity24h,
} from "@/lib/server/marketDataFns";
import { memorizzaBiasIct } from "@/lib/server/ictDirezione";

function compostoBias(c1d: unknown, biasD1: string, biasH4: string) {
  if (!c1d) {
    return {
      ictBias: (biasH4 === "rialzista" || biasH4 === "ribassista" ? biasH4 : "laterale") as MarketSnapshot["ictBias"],
      h4Conferma: "sconosciuto" as H4Conferma,
    };
  }
  return componiBiasIct(biasD1, biasH4);
}

async function tryTwelveData(): Promise<MarketSnapshot | null> {
  const xau = await tdFetchQuote("XAU/USD");
  if (!xau) return null;
  const adesso = new Date();
  const calendarioMercati = getMarketCalendarContext(adesso);
  const [c5, c15, c30, c1h, c4h, c1d, macro] = await Promise.all([
    tdFetchTimeSeries("XAU/USD", "5min", 40),
    tdFetchTimeSeries("XAU/USD", "15min", 40),
    tdFetchTimeSeries("XAU/USD", "30min", 40),
    tdFetchTimeSeries("XAU/USD", "1h", 40),
    tdFetchTimeSeries("XAU/USD", "4h", 40),
    tdFetchTimeSeries("XAU/USD", "1day", 30),
    getMacroContext(),
  ]);
  if (!c5 || !c15 || !c1h) return null;
  const atr15 = computeATR(c15, 14);
  const atr5 = computeATR(c5, 14);
  const atr30 = c30 ? computeATR(c30, 14) : null;
  const atr1h = computeATR(c1h, 14);
  const biasD1 = c1d ? computeStructure(c1d).bias : "laterale";
  const biasH4 = c4h ? computeStructure(c4h).bias : "laterale";
  const composto = compostoBias(c1d, biasD1, biasH4);
  return {
    xauusd: xau.close,
    xauusdChangePct: xau.percent_change,
    xauusdQuotedAt: xau.quotedAt,
    dxy: macro.dxy.value,
    dxyChangePct: macro.dxy.changePct,
    us10y: macro.us10y.value,
    us10yChangePct: macro.us10y.changePct,
    candles: { "5m": c5, "15m": c15, "30m": c30 ?? [], "1h": c1h, "4h": c4h ?? [] },
    source: "twelvedata",
    atr15m: atr15,
    atr1h,
    atr5m: atr5,
    atr30m: atr30,
    levels: computeLevels(c15, xau.close, atr15),
    levels5m: computeLevels5m(c5, xau.close, atr5),
    levels30m: computeLevels30m(c30 ?? undefined, xau.close, atr30),
    session: computeSessionInfo(adesso, calendarioMercati),
    marketCalendar: calendarioMercati,
    rigetto5m: computeRejection(c5, atr5),
    rigetto15m: computeRejection(c15, atr15),
    rigetto30m: computeRejection(c30 ?? undefined, atr30),
    liquidita24h: computeLiquidity24h(c1h ?? undefined),
    dxySource: macro.dxy.source,
    dxyAgeMinutes: macro.dxy.ageMinutes,
    us10ySource: macro.us10y.source,
    us10yAgeMinutes: macro.us10y.ageMinutes,
    biasD1,
    biasH4,
    h4Conferma: composto.h4Conferma,
    ictBias: composto.ictBias,
    livelliApertura: calcolaLivelliApertura(c1d ?? [], xau.close),
    oteM15: oteDaSwing(computeSwings(c15), xau.close),
    killZone: killZoneCorrente(adesso),
    judasSwing: rilevaJudasSwing(c15),
    ictStrutturaH4: computeStructure(c4h ?? []),
    ictOrderBlocksH4: computeOrderBlocks(c4h ?? []),
    ictFvgH4: computeFVG(c4h ?? []),
    ictLivelliUgualiH4: computeEqualLevels(c4h ?? [], computeATR(c4h ?? [], 14)),
    ictStrutturaH1: computeStructure(c1h),
    ictOrderBlocksH1: computeOrderBlocks(c1h),
    ictFvgH1: computeFVG(c1h),
    ictLivelliUgualiH1: computeEqualLevels(c1h, atr1h),
    ictStrutturaM30: computeStructure(c30 ?? []),
    ictStrutturaM15: computeStructure(c15),
    ictStrutturaM5: computeStructure(c5),
    ictOrderBlocksM30: computeOrderBlocks(c30 ?? []),
    ictFvgM30: computeFVG(c30 ?? []),
    ictLivelliUgualiM30: computeEqualLevels(c30 ?? [], atr30),
    ictOrderBlocksM15: computeOrderBlocks(c15),
    ictFvgM15: computeFVG(c15),
    ictLivelliUgualiM15: computeEqualLevels(c15, atr15),
    ictOrderBlocksM5: computeOrderBlocks(c5),
    ictFvgM5: computeFVG(c5),
  };
}

export async function getCurrentPrice(): Promise<number | null> {
  const metaQuote = await metaApiFetchQuote();
  if (metaQuote && !isMetaApiPriceStale(metaQuote.quotedAt)) return metaQuote.close;
  const tdQuote = await tdFetchQuote("XAU/USD");
  return tdQuote ? tdQuote.close : null;
}

export async function getMarketSnapshot() {
  const snap = await tryTwelveData();
  if (!snap) throw new Error("Impossibile recuperare dati di mercato: MetaApi e Twelve Data entrambi falliti");
  memorizzaBiasIct(snap.biasD1, snap.biasH4, snap.h4Conferma);
  return { ...snap, fetchedAt: new Date().toISOString() };
}
