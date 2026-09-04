import { ensureSchema, insertSignal, insertMarketSnapshot, getSegnaleAttivo, closeSignal } from "@/lib/server/db";
import { getMarketSnapshot, getCurrentPrice, isMarketOpen } from "@/lib/server/marketData";
import { getRelevantNews } from "@/lib/server/news";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { validateSignal } from "@/lib/server/validateSignal";
import { valutaSetupTrend } from "@/lib/server/trendStrategy";
import { sendPushToAll } from "@/lib/server/pushSend";
import { chiamaSeAttivo } from "@/lib/server/twilioCall";

export async function runTrendAnalysis(options?: { force?: boolean }) {
  const force = options?.force ?? false;

  if (!isMarketOpen()) {
    return { skipped: true, reason: "market_closed" };
  }

  await ensureSchema();

  const latest = await getSegnaleAttivo();
  const aperto =
    latest && (latest.direction === "BUY" || latest.direction === "SELL") && !latest.outcome;

  if (aperto && latest) {
    const prezzo = await getCurrentPrice();
    const entry = Number(latest.entry);
    const stopLoss = Number(latest.stop_loss);
    const tp1 = Number(latest.tp1);
    const risk = Math.abs(entry - stopLoss);

    if (prezzo !== null && risk > 0) {
      const hitStop = latest.direction === "BUY" ? prezzo <= stopLoss : prezzo >= stopLoss;
      const hitTp = latest.direction === "BUY" ? prezzo >= tp1 : prezzo <= tp1;
      if (hitStop || hitTp) {
        await closeSignal(latest.id, hitStop ? "LOSS" : "WIN", hitStop ? -1 : Math.abs(tp1 - entry) / risk);
      } else if (!force) {
        return {
          skipped: true,
          reason: "signal_active",
          activeSignalId: latest.id,
          direction: latest.direction,
          currentPrice: prezzo,
        };
      }
    } else if (!force) {
      return { skipped: true, reason: "signal_active", activeSignalId: latest.id };
    }
  }

  const marketSnapshot = await getMarketSnapshot();
  await insertMarketSnapshot(marketSnapshot).catch(() => undefined);

  const [news, calendar] = await Promise.all([
    getRelevantNews().catch(() => []),
    getEconomicCalendar().catch(() => []),
  ]);

  const highImpact = calendar.filter((e) => e.impact === "high");
  const vicinoNews = highImpact.some((e) => {
    const t = new Date(e.time).getTime();
    return Number.isFinite(t) && Math.abs(Date.now() - t) < 30 * 60 * 1000;
  });
  if (vicinoNews) {
    const skipped = validateSignal({
      direction: "NO_TRADE",
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      riskReward: null,
      confidence: 0,
      reasoning: "News ad alto impatto entro 30 minuti. Nessun trade.",
    });
    const saved = await insertSignal(skipped);
    return { signalId: saved.id, direction: "NO_TRADE", rejectedReason: skipped.reasoning, newsCount: news.length };
  }

  const setup = valutaSetupTrend({
    prezzo: Number(marketSnapshot.xauusd),
    atr15m: marketSnapshot.atr15m ?? null,
    atr1h: marketSnapshot.atr1h ?? null,
    session: marketSnapshot.session,
    candles: marketSnapshot.candles,
  });

  const signal = setup.ok && setup.direzione
    ? validateSignal({
        direction: setup.direzione,
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        tp1: setup.tp1,
        tp2: setup.tp2,
        riskReward: setup.rischioRendimento,
        confidence: 70,
        reasoning: setup.motivo,
      })
    : validateSignal({
        direction: "NO_TRADE",
        entry: null,
        stopLoss: null,
        tp1: null,
        tp2: null,
        riskReward: null,
        confidence: 0,
        reasoning: setup.motivo,
      });

  const saved = await insertSignal(signal);

  if (signal.direction === "BUY" || signal.direction === "SELL") {
    const prezzoTesto = Number(marketSnapshot.xauusd).toFixed(2);
    sendPushToAll({
      title: `${signal.direction} · ORB · ${prezzoTesto}`,
      body: `Entry ${Number(signal.entry).toFixed(2)} · SL ${Number(signal.stopLoss).toFixed(2)} · TP1 ${Number(signal.tp1).toFixed(2)} · TP2 ${Number(signal.tp2).toFixed(2)}`,
      url: "/",
    }).catch(() => undefined);
    chiamaSeAttivo(
      `Segnale ${signal.direction === "BUY" ? "acquisto" : "vendita"} su oro. Entrata ${Number(signal.entry).toFixed(2)}. Stop ${Number(signal.stopLoss).toFixed(2)}.`,
    ).catch(() => undefined);
  }

  return {
    signalId: saved.id,
    direction: signal.direction,
    confidence: signal.confidence,
    xauusd: marketSnapshot.xauusd,
    atr15m: marketSnapshot.atr15m,
    dataSource: marketSnapshot.source,
    setup: setup.setup,
    rejectedReason: signal.rejectedReason ?? (!setup.ok ? setup.motivo : null),
    newsCount: news.length,
    calendarCount: calendar.length,
  };
}
