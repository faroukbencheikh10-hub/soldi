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
import { getMarketCalendarContext } from "@/lib/server/marketCalendar";
import {
  computeSessionInfo,
  componiBiasIct,
  type MarketSnapshot,
} from "@/lib/server/marketData";
import { computeLiquidity24h, type Candle } from "@/lib/server/marketDataFns";

export async function costruisciSnapshot(input: {
  xau: { close: number; percent_change: number; quotedAt: number | null };
  c5: Candle[];
  c15: Candle[];
  c30: Candle[] | null;
  c1h: Candle[];
  c4h: Candle[] | null;
  c1d: Candle[] | null;
  source: "metaapi" | "twelvedata";
}): Promise<MarketSnapshot> {
  const { xau, c5, c15, c1h, source } = input;
  const c30 = input.c30 ?? [];
  const c4h = input.c4h ?? [];
  const c1d = input.c1d;
  const adesso = new Date();
  const calendarioMercati = getMarketCalendarContext(adesso);
  const macro = await getMacroContext();
  const atr15 = computeATR(c15, 14);
  const atr5 = computeATR(c5, 14);
  const atr30 = c30.length ? computeATR(c30, 14) : null;
  const atr1h = computeATR(c1h, 14);
  const biasD1 = c1d ? computeStructure(c1d).bias : "laterale";
  const biasH4 = c4h.length ? computeStructure(c4h).bias : "laterale";
  const composto = c1d
    ? componiBiasIct(biasD1, biasH4)
    : {
        ictBias: (biasH4 === "rialzista" || biasH4 === "ribassista" ? biasH4 : "laterale") as MarketSnapshot["ictBias"],
        h4Conferma: "sconosciuto" as MarketSnapshot["h4Conferma"],
      };
  return {
    xauusd: xau.close,
    xauusdChangePct: xau.percent_change,
    xauusdQuotedAt: xau.quotedAt,
    dxy: macro.dxy.value,
    dxyChangePct: macro.dxy.changePct,
    us10y: macro.us10y.value,
    us10yChangePct: macro.us10y.changePct,
    candles: { "5m": c5, "15m": c15, "30m": c30, "1h": c1h, "4h": c4h },
    source,
    atr15m: atr15,
    atr1h,
    atr5m: atr5,
    atr30m: atr30,
    levels: computeLevels(c15, xau.close, atr15),
    levels5m: computeLevels5m(c5, xau.close, atr5),
    levels30m: computeLevels30m(c30.length ? c30 : undefined, xau.close, atr30),
    session: computeSessionInfo(adesso, calendarioMercati),
    marketCalendar: calendarioMercati,
    rigetto5m: computeRejection(c5, atr5),
    rigetto15m: computeRejection(c15, atr15),
    rigetto30m: computeRejection(c30.length ? c30 : undefined, atr30),
    liquidita24h: computeLiquidity24h(c1h),
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
    ictStrutturaH4: computeStructure(c4h),
    ictOrderBlocksH4: computeOrderBlocks(c4h),
    ictFvgH4: computeFVG(c4h),
    ictLivelliUgualiH4: computeEqualLevels(c4h, computeATR(c4h, 14)),
    ictStrutturaH1: computeStructure(c1h),
    ictOrderBlocksH1: computeOrderBlocks(c1h),
    ictFvgH1: computeFVG(c1h),
    ictLivelliUgualiH1: computeEqualLevels(c1h, atr1h),
    ictStrutturaM30: computeStructure(c30),
    ictStrutturaM15: computeStructure(c15),
    ictStrutturaM5: computeStructure(c5),
    ictOrderBlocksM30: computeOrderBlocks(c30),
    ictFvgM30: computeFVG(c30),
    ictLivelliUgualiM30: computeEqualLevels(c30, atr30),
    ictOrderBlocksM15: computeOrderBlocks(c15),
    ictFvgM15: computeFVG(c15),
    ictLivelliUgualiM15: computeEqualLevels(c15, atr15),
    ictOrderBlocksM5: computeOrderBlocks(c5),
    ictFvgM5: computeFVG(c5),
  };
}
