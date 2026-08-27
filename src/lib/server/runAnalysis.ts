import {
  ensureSchema,
  insertSignal,
  insertMarketSnapshot,
  insertContextSnapshot,
  getLatestSignal,
  closeSignal,
  insertSignal5m,
  getLatestSignal5m,
  closeSignal5m,
  isAiPaused,
  getSetting,
  setSetting,
  inserisciEventiSetup,
  inserisciContesto,
  getUltimoContesto,
  getEventiSetupAttivi,
  chiudiEventoSetup,
  insertSignal30m,
  getLatestSignal30m,
  hasTradedSetup30m,
  getOpenSignalsOtherChannels,
  closeSignal30m,
} from "@/lib/server/db";
import {
  getMarketSnapshot,
  getCurrentPrice,
  isMarketOpen,
  type MarketSnapshot,
} from "@/lib/server/marketData";
import { metaApiFetchTimeSeries } from "@/lib/server/metaApiData";
import { getRelevantNews } from "@/lib/server/news";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { generateSignal, generateSignal30m, generateSignal5m } from "@/lib/server/agent";
import { validateSignal } from "@/lib/server/validateSignal";
import { sendPushToAll } from "@/lib/server/pushSend";
import { shouldCallAI, hasTechnicalSetup } from "@/lib/server/aiGate";
import {
  rilevaEventi,
  motivoInvalidazione,
  eventoScaduto,
  prezzoDentroUnaZona,
  calcolaFingerprint,
  type EventoAttivo,
} from "@/lib/server/setupState";
import {
  costruisciContesto,
  comprimiContesto,
  firmaContesto,
  calcolaTransizione,
  type EventoContesto,
  type ContestoCompresso,
} from "@/lib/server/marketContext";

const SIGNAL_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// Il controllo tecnico gira a ogni ciclo (anche ogni minuto). Questi limiti
// riguardano SOLO le scritture e le chiamate a pagamento, non il monitoraggio.
// - l'AI non viene chiamata due volte a meno di un minuto di distanza
// - lo snapshot di mercato si persiste al massimo ogni 5 minuti
const INTERVALLO_MINIMO_AI_MS = 60 * 1000;
const INTERVALLO_SNAPSHOT_MS = 5 * 60 * 1000;
const SIGNAL_TIMEOUT_MS_5M = 60 * 60 * 1000;
const SIGNAL_TIMEOUT_MS_30M = 8 * 60 * 60 * 1000;
// Filtro tecnico locale: quanti segnali tecnici servono per giustificare una
// chiamata a OpenAI sul canale oro.
const SOGLIA_SETUP_ORO = 1;

// Esito di un trade ricostruito dalle candele, non dal prezzo dell'istante.
// Prima si confrontava solo il prezzo corrente con stop e target: se il prezzo
// toccava il target e tornava indietro fra un controllo e l'altro, quel target
// non veniva mai visto e il trade finiva per scadere a "pareggio".
async function esitoDalleCandele(
  direzione: string,
  apertoIl: string | Date,
  stopLoss: number,
  tp1: number,
  numeroCandele = 60
): Promise<"WIN" | "LOSS" | null> {
  const candele = await metaApiFetchTimeSeries("5min", numeroCandele);
  if (!candele || candele.length === 0) return null;

  const apertura = new Date(apertoIl).getTime();
  if (!Number.isFinite(apertura)) return null;

  const rilevanti = candele
    .filter((c) => new Date(c.datetime).getTime() >= apertura)
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

  for (const c of rilevanti) {
    const massimo = Number(c.high);
    const minimo = Number(c.low);
    if (!Number.isFinite(massimo) || !Number.isFinite(minimo)) continue;

    const toccatoStop = direzione === "BUY" ? minimo <= stopLoss : massimo >= stopLoss;
    const toccatoTarget = direzione === "BUY" ? massimo >= tp1 : minimo <= tp1;

    // Se nella stessa candela risultano toccati entrambi non sappiamo quale sia
    // arrivato per primo: si assume il caso peggiore, cioe' lo stop.
    if (toccatoStop) return "LOSS";
    if (toccatoTarget) return "WIN";
  }

  return null;
}

export async function runAnalysis(options?: { force?: boolean; marketSnapshot?: MarketSnapshot }) {
  const force = options?.force ?? false;

  if (!isMarketOpen()) {
    return { skipped: true, reason: "market_closed" };
  }

  await ensureSchema();

  if (await isAiPaused()) {
    return { skipped: true, reason: "ai_paused" };
  }

  const latest = await getLatestSignal();
  const hasOpenTrade =
    latest && (latest.direction === "BUY" || latest.direction === "SELL") && !latest.outcome;

  let currentPrice: number | null = null;
  let naturalOutcome: "WIN" | "LOSS" | null = null;
  let entry = 0;
  let stopLoss = 0;
  let tp1 = 0;
  let risk = 0;

  let expired = false;

  if (hasOpenTrade) {
    currentPrice = await getCurrentPrice();
    entry = Number(latest.entry);
    stopLoss = Number(latest.stop_loss);
    tp1 = Number(latest.tp1);
    risk = Math.abs(entry - stopLoss);

    // Prima fonte: le candele dall'apertura del trade in poi.
    naturalOutcome = await esitoDalleCandele(latest.direction, latest.created_at, stopLoss, tp1);

    // Ripiego sul prezzo dell'istante solo se le candele non sono disponibili.
    if (naturalOutcome === null && currentPrice !== null) {
      if (latest.direction === "BUY") {
        if (currentPrice <= stopLoss) naturalOutcome = "LOSS";
        else if (currentPrice >= tp1) naturalOutcome = "WIN";
      } else {
        if (currentPrice >= stopLoss) naturalOutcome = "LOSS";
        else if (currentPrice <= tp1) naturalOutcome = "WIN";
      }
    }

    if (naturalOutcome) {
      // Una vincita vale esattamente la distanza fino a TP1, non la posizione
      // casuale del prezzo nel momento in cui il cron se ne accorge.
      const resultR = naturalOutcome === "WIN" && risk > 0 ? Math.abs(tp1 - entry) / risk : -1;
      await closeSignal(latest.id, naturalOutcome, resultR);
    } else {
      const ageMs = Date.now() - new Date(latest.created_at).getTime();
      expired = ageMs > SIGNAL_TIMEOUT_MS;

      if (expired) {
        // Prima la scadenza registrava sempre 0, anche su un trade che era a
        // +0,9R: i vincitori venivano tagliati e le statistiche sottostimavano
        // la strategia. Ora si registra il risultato vero al momento della
        // chiusura. L'esito resta BREAKEVEN perche' ne' stop ne' target sono
        // stati toccati, ma il risultato in R e' quello reale.
        const resultR =
          currentPrice !== null && risk > 0
            ? Number(
                ((latest.direction === "BUY" ? currentPrice - entry : entry - currentPrice) / risk).toFixed(2)
              )
            : 0;
        await closeSignal(
          latest.id,
          "BREAKEVEN",
          resultR,
          `\n\n[Scaduto: nessun SL/TP toccato entro 4 ore. Chiuso al prezzo corrente, risultato reale ${resultR}R.]`
        );
      } else if (!force) {
        try {
          const freshSnapshot = options?.marketSnapshot ?? (await getMarketSnapshot());
          await insertMarketSnapshot(freshSnapshot);
        } catch (err) {
          console.error("[runAnalysis] snapshot di aggiornamento (trade aperto) fallito:", err);
        }

        return {
          skipped: true,
          reason: "signal_active",
          activeSignalId: latest.id,
          direction: latest.direction,
          entry: currentPrice !== null ? entry : Number(latest.entry),
          currentPrice: currentPrice ?? undefined,
        };
      }
    }
  }

  const marketSnapshot = options?.marketSnapshot ?? (await getMarketSnapshot());

  if (hasOpenTrade && !naturalOutcome && !expired && force) {
    const note =
      currentPrice === null
        ? "\n\n[Chiuso manualmente: nuova generazione richiesta dall'utente, prezzo attuale non verificabile.]"
        : "\n\n[Chiuso manualmente: sostituito da una nuova generazione richiesta dall'utente.]";
    await closeSignal(latest!.id, "BREAKEVEN", 0, note);
  }

  // ======================= MONITOR (gira a ogni ciclo) ====================
  // Nessuna AI qui dentro: si aggiorna solo la memoria degli eventi tecnici.

  // 1) nuovi eventi sulle candele CHIUSE, registrati una volta sola
  const eventiRilevati = [
    ...rilevaEventi(marketSnapshot.candles["1h"], marketSnapshot.atr1h, "H1"),
    ...rilevaEventi(marketSnapshot.candles["30m"], marketSnapshot.atr30m, "M30"),
    ...rilevaEventi(marketSnapshot.candles["5m"], marketSnapshot.atr5m, "M5"),
  ];
  await inserisciEventiSetup(eventiRilevati);

  // 2) chiusura di quelli negati dal prezzo, o scaduti per il tetto di sicurezza
  const adesso = Date.now();
  const eventiAttivi: EventoAttivo[] = [];
  const chiusiOra: string[] = [];

  for (const riga of await getEventiSetupAttivi()) {
    const evento: EventoAttivo = {
      id: String(riga.id),
      tipo: riga.tipo,
      timeframe: riga.timeframe,
      direzione: riga.direzione,
      livello: Number(riga.livello),
      candelaTs: new Date(riga.candela_ts).toISOString(),
      rilevatoIl: new Date(riga.rilevato_il).toISOString(),
    };
    const candele =
      evento.timeframe === "H1"
        ? marketSnapshot.candles["1h"]
        : evento.timeframe === "M30"
          ? marketSnapshot.candles["30m"]
          : marketSnapshot.candles["5m"];

    const motivo = motivoInvalidazione(evento, candele);
    if (motivo) {
      await chiudiEventoSetup(evento.id, "INVALIDATED", motivo);
      chiusiOra.push(`${evento.tipo} ${evento.timeframe} ${evento.direzione} invalidato (${motivo})`);
      continue;
    }
    if (eventoScaduto(evento, adesso)) {
      await chiudiEventoSetup(evento.id, "EXPIRED", "tetto di sicurezza superato");
      chiusiOra.push(`${evento.tipo} ${evento.timeframe} ${evento.direzione} scaduto`);
      continue;
    }
    eventiAttivi.push(evento);
  }

  // 3) contesto strutturato: assemblato dagli eventi attivi e dallo snapshot,
  //    non persistito perche' interamente ricalcolabile e quindi impossibile
  //    da far divergere dal grafico.
  const eventiPerContesto: EventoContesto[] = eventiAttivi.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    timeframe: e.timeframe,
    direzione: e.direzione,
    livello: e.livello,
    candelaTs: e.candelaTs,
  }));
  const contesto = costruisciContesto(
    {
      prezzo: marketSnapshot.xauusd,
      candles: marketSnapshot.candles,
      atr1h: marketSnapshot.atr1h,
      atr30m: marketSnapshot.atr30m,
      atr5m: marketSnapshot.atr5m,
      liquidita24h: marketSnapshot.liquidita24h,
      zoneH1: {
        orderBlocks: marketSnapshot.ictOrderBlocksH1,
        fvg: marketSnapshot.ictFvgH1,
        livelliUguali: marketSnapshot.ictLivelliUgualiH1,
      },
      zoneM30: {
        orderBlocks: marketSnapshot.ictOrderBlocksM30,
        fvg: marketSnapshot.ictFvgM30,
        livelliUguali: marketSnapshot.ictLivelliUgualiM30,
      },
      zoneM5: {
        orderBlocks: marketSnapshot.ictOrderBlocksM5,
        fvg: marketSnapshot.ictFvgM5,
        livelliUguali: null,
      },
    },
    eventiPerContesto,
    chiusiOra.map((c) => ({ tipo: "", timeframe: "", direzione: "", motivo: c }))
  );

  // 4) REGISTRO: una riga solo quando il contesto cambia in modo significativo.
  //    La firma non contiene il prezzo di proposito: il prezzo che oscilla non
  //    e' un cambio di contesto. Questa tabella e' solo audit -- il contesto
  //    resta ricalcolato dalle candele e da setup_events a ogni ciclo, e non
  //    viene mai riletto da qui per prendere decisioni.
  const firma = firmaContesto(contesto);
  const firmaPrecedente = await getSetting("contesto_firma");
  if (firma !== firmaPrecedente) {
    const rigaPrecedente = await getUltimoContesto();
    const statoPrecedente = (rigaPrecedente?.stato ?? null) as ContestoCompresso | null;
    const transizione = calcolaTransizione(statoPrecedente, contesto);
    await inserisciContesto(marketSnapshot.xauusd, firma, comprimiContesto(contesto), transizione);
    await setSetting("contesto_firma", firma);
  }

  // 5) stato leggero: prova che il monitor ha girato, senza toccare lo storico
  await setSetting("monitor_last_checked_at", new Date().toISOString());
  await setSetting(
    "contesto_sintesi",
    JSON.stringify({
      h1: { regime: contesto.h1.regime, fase: contesto.h1.fase },
      m30: { regime: contesto.m30.regime, fase: contesto.m30.fase },
      m5: { regime: contesto.m5.regime, fase: contesto.m5.fase },
      prezzo: contesto.prezzo,
      aggiornatoIl: contesto.aggiornatoIl,
    })
  );

  // 6) impronta del setup
  const zonaRaggiunta = prezzoDentroUnaZona(marketSnapshot.xauusd, [
    marketSnapshot.ictOrderBlocksH1,
    marketSnapshot.ictFvgH1,
    marketSnapshot.ictOrderBlocksM30,
    marketSnapshot.ictFvgM30,
    marketSnapshot.ictOrderBlocksM5,
    marketSnapshot.ictFvgM5,
  ]);
  const impronta = calcolaFingerprint(
    eventiAttivi,
    marketSnapshot.xauusd,
    marketSnapshot.atr30m,
    zonaRaggiunta
  );
  const improntaPrecedente = await getSetting("setup_fingerprint");
  const improntaCambiata = impronta !== improntaPrecedente;

  // 7) lo snapshot di mercato si scrive al massimo ogni 5 minuti
  const ultimoSnapshot = await getSetting("last_snapshot_at");
  if (!ultimoSnapshot || adesso - new Date(ultimoSnapshot).getTime() >= INTERVALLO_SNAPSHOT_MS) {
    await insertMarketSnapshot(marketSnapshot);
    await setSetting("last_snapshot_at", new Date().toISOString());
  }

  // 8) setup invariato: il ciclo finisce qui. Niente riga nello storico,
  //    niente AI, si riusa l'analisi precedente.
  if (!force && !improntaCambiata && chiusiOra.length === 0) {
    return {
      skipped: true,
      reason: "setup_invariato",
      eventiAttivi: eventiAttivi.length,
      zonaRaggiunta,
      contesto: {
        h1: { regime: contesto.h1.regime, fase: contesto.h1.fase },
        m30: { regime: contesto.m30.regime, fase: contesto.m30.fase },
        m5: { regime: contesto.m5.regime, fase: contesto.m5.fase },
      },
      segnaleRiusato: await getSetting("setup_last_signal_id"),
      controllatoIl: new Date().toISOString(),
    };
  }

  await setSetting("setup_fingerprint", impronta);
  // ====================== fine MONITOR ===================================

  const [news, calendar] = await Promise.all([
    getRelevantNews().catch(() => []),
    getEconomicCalendar().catch(() => []),
  ]);
  await insertContextSnapshot(news, calendar);

  // Un setup che muore va registrato: e' un cambiamento di stato, non rumore.
  if (chiusiOra.length > 0) {
    await insertSignal(
      validateSignal({
        direction: "NO_TRADE",
        entry: null,
        stopLoss: null,
        tp1: null,
        tp2: null,
        riskReward: null,
        confidence: 0,
        reasoning: `Setup aggiornato: ${chiusiOra.join("; ")}. Eventi ancora attivi: ${eventiAttivi.length}.`,
      })
    );
  }

  const gate = shouldCallAI(marketSnapshot.session.sessione === "asia", calendar, news);
  if (!gate.allowed) {
    const skippedSignal = validateSignal({
      direction: "NO_TRADE",
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      riskReward: null,
      confidence: 0,
      reasoning: gate.reason,
    });
    const saved = await insertSignal(skippedSignal);
    return {
      signalId: saved.id,
      direction: skippedSignal.direction,
      confidence: skippedSignal.confidence,
      xauusd: marketSnapshot.xauusd,
      atr15m: marketSnapshot.atr15m,
      dxySource: marketSnapshot.dxySource,
      us10ySource: marketSnapshot.us10ySource,
      newsCount: news.length,
      newsAsia: news.filter((n) => n.area === "asia").length,
      calendarCount: calendar.length,
      dataSource: marketSnapshot.source,
      rejectedReason: gate.reason,
      aiSkipped: true,
    };
  }

  // Filtro tecnico locale: se non c'e' nulla di interessante sul grafico non
  // chiamiamo l'AI (risparmio credito). La generazione manuale (force) passa
  // sempre, e il ciclo viene comunque registrato come NO_TRADE con la ragione.
  const setupTecnico = hasTechnicalSetup(
    marketSnapshot,
    marketSnapshot.xauusd,
    SOGLIA_SETUP_ORO,
    eventiAttivi
  );
  if (!force && !setupTecnico.allowed) {
    const skippedSignal = validateSignal({
      direction: "NO_TRADE",
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      riskReward: null,
      confidence: 0,
      reasoning: setupTecnico.reason,
    });
    const saved = await insertSignal(skippedSignal);
    return {
      signalId: saved.id,
      direction: skippedSignal.direction,
      confidence: skippedSignal.confidence,
      xauusd: marketSnapshot.xauusd,
      atr15m: marketSnapshot.atr15m,
      dxySource: marketSnapshot.dxySource,
      us10ySource: marketSnapshot.us10ySource,
      newsCount: news.length,
      newsAsia: news.filter((n) => n.area === "asia").length,
      calendarCount: calendar.length,
      dataSource: marketSnapshot.source,
      rejectedReason: setupTecnico.reason,
      aiSkipped: true,
    };
  }

  // Unica guardia rimasta sulle chiamate a pagamento: mai due analisi AI a
  // meno di un minuto l'una dall'altra, nemmeno se l'impronta cambia.
  const ultimaAi = await getSetting("setup_last_ai_at");
  if (!force && ultimaAi && adesso - new Date(ultimaAi).getTime() < INTERVALLO_MINIMO_AI_MS) {
    return {
      skipped: true,
      reason: "ai_troppo_ravvicinata",
      eventiAttivi: eventiAttivi.length,
      segnaleRiusato: await getSetting("setup_last_signal_id"),
    };
  }
  await setSetting("setup_last_ai_at", new Date().toISOString());

  const rawSignal = await generateSignal({
    marketSnapshot,
    news,
    calendar,
    memoriaMercato: comprimiContesto(contesto) as unknown as Record<string, unknown>,
    eventiAttivi: eventiPerContesto,
    scenario: null,
  });
  const signal = validateSignal(rawSignal, "atr15m", 60);
  const saved = await insertSignal(signal);
  await setSetting("setup_last_signal_id", saved.id);

  if (signal.direction === "BUY" || signal.direction === "SELL") {
    sendPushToAll({
      title: `Nuovo segnale: ${signal.direction}`,
      body: `Entry ${signal.entry} · Confidence ${signal.confidence}%`,
      url: "/",
    }).catch((err) => console.error("[runAnalysis] invio push fallito:", err));
  }

  return {
    signalId: saved.id,
    direction: signal.direction,
    confidence: signal.confidence,
    xauusd: marketSnapshot.xauusd,
    atr15m: marketSnapshot.atr15m,
    rotturaInAtr: marketSnapshot.levels?.rotturaRialzoInAtr ?? null,
    stopAtrRatio: signal.stopAtrRatio ?? null,
    dxySource: marketSnapshot.dxySource,
    us10ySource: marketSnapshot.us10ySource,
    newsCount: news.length,
    newsAsia: news.filter((n) => n.area === "asia").length,
    calendarCount: calendar.length,
    dataSource: marketSnapshot.source,
    rejectedReason: signal.rejectedReason ?? null,
  };
}

export async function runAnalysis30m(options?: { marketSnapshot?: MarketSnapshot }) {
  if (!isMarketOpen()) {
    return { skipped: true, reason: "market_closed" };
  }

  await ensureSchema();

  if (await isAiPaused()) {
    return { skipped: true, reason: "ai_paused" };
  }

  const latest = await getLatestSignal30m();
  const hasOpenTrade =
    latest && (latest.direction === "BUY" || latest.direction === "SELL") && !latest.outcome;

  if (hasOpenTrade) {
    const currentPrice = await getCurrentPrice();
    const entry = Number(latest.entry);
    const stopLoss = Number(latest.stop_loss);
    const tp1 = Number(latest.tp1);
    const risk = Math.abs(entry - stopLoss);

    let naturalOutcome = await esitoDalleCandele(
      latest.direction,
      latest.created_at,
      stopLoss,
      tp1,
      120
    );

    if (naturalOutcome === null && currentPrice !== null) {
      if (latest.direction === "BUY") {
        if (currentPrice <= stopLoss) naturalOutcome = "LOSS";
        else if (currentPrice >= tp1) naturalOutcome = "WIN";
      } else {
        if (currentPrice >= stopLoss) naturalOutcome = "LOSS";
        else if (currentPrice <= tp1) naturalOutcome = "WIN";
      }
    }

    if (naturalOutcome) {
      const resultR =
        naturalOutcome === "WIN" && risk > 0 ? Math.abs(tp1 - entry) / risk : -1;
      await closeSignal30m(latest.id, naturalOutcome, resultR);
    } else {
      const ageMs = Date.now() - new Date(latest.created_at).getTime();
      if (ageMs <= SIGNAL_TIMEOUT_MS_30M) {
        return {
          skipped: true,
          reason: "signal_30m_active",
          activeSignalId: latest.id,
          direction: latest.direction,
          entry,
          currentPrice: currentPrice ?? undefined,
        };
      }

      const resultR =
        currentPrice !== null && risk > 0
          ? Number(
              ((latest.direction === "BUY" ? currentPrice - entry : entry - currentPrice) / risk).toFixed(2)
            )
          : 0;
      await closeSignal30m(
        latest.id,
        "BREAKEVEN",
        resultR,
        `\n\n[Scaduto: nessun SL/TP toccato entro 8 ore. Risultato reale ${resultR}R.]`
      );
    }
  }

  const marketSnapshot = options?.marketSnapshot ?? (await getMarketSnapshot());

  // Il canale M30 possiede la propria lettura della memoria: continua a
  // funzionare anche quando un segnale del canale principale e' gia' aperto.
  await inserisciEventiSetup(
    rilevaEventi(marketSnapshot.candles["30m"], marketSnapshot.atr30m, "M30")
  );

  const eventiM30: EventoAttivo[] = [];
  const adesso = Date.now();

  for (const riga of await getEventiSetupAttivi()) {
    if (riga.timeframe !== "M30") continue;
    const evento: EventoAttivo = {
      id: String(riga.id),
      tipo: riga.tipo,
      timeframe: "M30",
      direzione: riga.direzione,
      livello: Number(riga.livello),
      candelaTs: new Date(riga.candela_ts).toISOString(),
      rilevatoIl: new Date(riga.rilevato_il).toISOString(),
    };

    const motivo = motivoInvalidazione(evento, marketSnapshot.candles["30m"]);
    if (motivo) {
      await chiudiEventoSetup(evento.id, "INVALIDATED", motivo);
      continue;
    }
    if (eventoScaduto(evento, adesso)) {
      await chiudiEventoSetup(evento.id, "EXPIRED", "tetto di sicurezza M30 superato");
      continue;
    }
    eventiM30.push(evento);
  }

  const zonaM30Raggiunta = prezzoDentroUnaZona(marketSnapshot.xauusd, [
    marketSnapshot.ictOrderBlocksM30,
    marketSnapshot.ictFvgM30,
  ]);
  const strutturaM30 = marketSnapshot.ictStrutturaM30;
  const strutturaM15 = marketSnapshot.ictStrutturaM15;
  const fingerprint = [
    calcolaFingerprint(eventiM30, marketSnapshot.xauusd, marketSnapshot.atr30m, zonaM30Raggiunta),
    `m30=${strutturaM30.evento ?? "none"}:${strutturaM30.direzioneEvento ?? strutturaM30.bias}:${strutturaM30.livelloRotto ?? "none"}`,
    `m15=${strutturaM15.evento ?? "none"}:${strutturaM15.direzioneEvento ?? strutturaM15.bias}`,
    `rigetto=${marketSnapshot.rigetto30m.rilevato ? marketSnapshot.rigetto30m.direzione ?? "si" : "no"}`,
  ].join("#");

  const fingerprintPrecedente = await getSetting("m30_setup_fingerprint");
  if (fingerprint === fingerprintPrecedente) {
    return {
      skipped: true,
      reason: "setup_30m_invariato",
      eventiAttivi: eventiM30.length,
      zonaRaggiunta: zonaM30Raggiunta,
    };
  }
  await setSetting("m30_setup_fingerprint", fingerprint);

  if (eventiM30.length === 0) {
    const noSetup = validateSignal({
      direction: "NO_TRADE",
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      riskReward: null,
      confidence: 0,
      reasoning: "Nessun evento M30 attivo nella memoria del setup.",
    });
    const saved = await insertSignal30m(noSetup, null);
    return {
      signalId: saved.id,
      direction: noSetup.direction,
      confidence: noSetup.confidence,
      aiSkipped: true,
      reason: "nessun_evento_m30_attivo",
    };
  }

  const ultimaAi = await getSetting("m30_last_ai_at");
  if (ultimaAi && adesso - new Date(ultimaAi).getTime() < INTERVALLO_MINIMO_AI_MS) {
    return { skipped: true, reason: "ai_30m_troppo_ravvicinata" };
  }
  await setSetting("m30_last_ai_at", new Date().toISOString());

  const [news, calendar] = await Promise.all([
    getRelevantNews().catch(() => []),
    getEconomicCalendar().catch(() => []),
  ]);

  const eventiPayload: EventoContesto[] = eventiM30.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    timeframe: e.timeframe,
    direzione: e.direzione,
    livello: e.livello,
    candelaTs: e.candelaTs,
  }));

  const rawSignal = await generateSignal30m({
    marketSnapshot,
    news,
    calendar,
    eventiAttivi: eventiPayload,
  });
  let signal = validateSignal(rawSignal, "atr30m", 60);

  const setupBase = eventiM30
    .map((e) => `${e.tipo}:${e.direzione}:${e.candelaTs}`)
    .sort()
    .join("|");
  const setupKey =
    signal.direction === "BUY" || signal.direction === "SELL"
      ? `${setupBase}#${signal.direction}`
      : setupBase;
  let duplicateBlocked = false;

  if (signal.direction === "BUY" || signal.direction === "SELL") {
    const tolleranza =
      marketSnapshot.atr30m !== null && marketSnapshot.atr30m > 0
        ? marketSnapshot.atr30m * 0.5
        : 0;
    const sovrapposto = (await getOpenSignalsOtherChannels()).find(
      (s) =>
        s.direction === signal.direction &&
        Math.abs(Number(s.entry) - Number(signal.entry)) <= tolleranza
    );
    if (sovrapposto) {
      duplicateBlocked = true;
      signal = {
        ...signal,
        direction: "NO_TRADE",
        entry: 0,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        riskReward: 0,
        rejectedReason: `Setup M30 sovrapposto al canale ${sovrapposto.canale}: doppia esposizione bloccata.`,
        reasoning: `Il setup M30 coincide con un trade ${sovrapposto.direction} gia' aperto nel canale ${sovrapposto.canale}.`,
      };
    }
  }

  if (
    (signal.direction === "BUY" || signal.direction === "SELL") &&
    (await hasTradedSetup30m(setupKey))
  ) {
    duplicateBlocked = true;
    signal = {
      ...signal,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
      rejectedReason: "Setup M30 gia' tradato: duplicato bloccato.",
      reasoning: "Setup M30 gia' tradato: attendo un nuovo evento strutturale.",
    };
  }

  const saved = await insertSignal30m(signal, setupKey);

  if ((signal.direction === "BUY" || signal.direction === "SELL") && saved.inserted) {
    sendPushToAll({
      title: `Nuovo setup M30: ${signal.direction}`,
      body: `Entry ${signal.entry} · Confidence ${signal.confidence}%`,
      url: "/",
    }).catch((err) => console.error("[runAnalysis30m] invio push fallito:", err));
  }

  return {
    signalId: saved.id,
    direction: signal.direction,
    confidence: signal.confidence,
    xauusd: marketSnapshot.xauusd,
    atr30m: marketSnapshot.atr30m,
    eventiAttivi: eventiM30.length,
    zonaRaggiunta: zonaM30Raggiunta,
    dataSource: marketSnapshot.source,
    rejectedReason: signal.rejectedReason ?? null,
    duplicateBlocked: duplicateBlocked || !saved.inserted,
  };
}

export async function runAnalysis5m(options?: { force?: boolean }) {
  const force = options?.force ?? false;

  if (!isMarketOpen()) {
    return { skipped: true, reason: "market_closed" };
  }

  await ensureSchema();

  if (await isAiPaused()) {
    return { skipped: true, reason: "ai_paused" };
  }

  const latest = await getLatestSignal5m();
  const hasOpenTrade =
    latest && (latest.direction === "BUY" || latest.direction === "SELL") && !latest.outcome;

  let currentPrice: number | null = null;
  let naturalOutcome: "WIN" | "LOSS" | null = null;
  let entry = 0;
  let stopLoss = 0;
  let tp1 = 0;
  let risk = 0;

  let expired5m = false;

  if (hasOpenTrade) {
    currentPrice = await getCurrentPrice();

    if (currentPrice !== null) {
      entry = Number(latest.entry);
      stopLoss = Number(latest.stop_loss);
      tp1 = Number(latest.tp1);
      risk = Math.abs(entry - stopLoss);

      if (latest.direction === "BUY") {
        if (currentPrice <= stopLoss) naturalOutcome = "LOSS";
        else if (currentPrice >= tp1) naturalOutcome = "WIN";
      } else {
        if (currentPrice >= stopLoss) naturalOutcome = "LOSS";
        else if (currentPrice <= tp1) naturalOutcome = "WIN";
      }
    }

    if (naturalOutcome) {
      const resultR =
        naturalOutcome === "WIN"
          ? (latest.direction === "BUY" ? currentPrice! - entry : entry - currentPrice!) / risk
          : -1;
      await closeSignal5m(latest.id, naturalOutcome, resultR);
    } else {
      const ageMs = Date.now() - new Date(latest.created_at).getTime();
      expired5m = ageMs > SIGNAL_TIMEOUT_MS_5M;

      if (expired5m) {
        await closeSignal5m(
          latest.id,
          "BREAKEVEN",
          0,
          "\n\n[Scaduto: nessun SL/TP toccato entro 1 ora, chiuso automaticamente per sbloccare nuovi segnali.]"
        );
      } else if (!force) {
        try {
          const freshSnapshot = await getMarketSnapshot();
          await insertMarketSnapshot(freshSnapshot);
        } catch (err) {
          console.error("[runAnalysis5m] snapshot di aggiornamento (trade aperto) fallito:", err);
        }

        return {
          skipped: true,
          reason: "signal_active",
          activeSignalId: latest.id,
          direction: latest.direction,
          entry: currentPrice !== null ? entry : Number(latest.entry),
          currentPrice: currentPrice ?? undefined,
        };
      }
    }
  }

  const marketSnapshot = await getMarketSnapshot();

  if (hasOpenTrade && !naturalOutcome && !expired5m && force) {
    const note =
      currentPrice === null
        ? "\n\n[Chiuso manualmente: nuova generazione richiesta dall'utente, prezzo attuale non verificabile.]"
        : "\n\n[Chiuso manualmente: sostituito da una nuova generazione richiesta dall'utente.]";
    await closeSignal5m(latest!.id, "BREAKEVEN", 0, note);
  }

  await insertMarketSnapshot(marketSnapshot);

  const [news, calendar] = await Promise.all([
    getRelevantNews().catch(() => []),
    getEconomicCalendar().catch(() => []),
  ]);
  await insertContextSnapshot(news, calendar);

  const gate = shouldCallAI(marketSnapshot.session.sessione === "asia", calendar, news);
  if (!gate.allowed) {
    const skippedSignal = validateSignal(
      {
        direction: "NO_TRADE",
        entry: null,
        stopLoss: null,
        tp1: null,
        tp2: null,
        riskReward: null,
        confidence: 0,
        reasoning: gate.reason,
      },
      "atr5m"
    );
    const saved = await insertSignal5m(skippedSignal);
    return {
      signalId: saved.id,
      direction: skippedSignal.direction,
      confidence: skippedSignal.confidence,
      xauusd: marketSnapshot.xauusd,
      atr5m: marketSnapshot.atr5m,
      dxySource: marketSnapshot.dxySource,
      us10ySource: marketSnapshot.us10ySource,
      newsCount: news.length,
      newsAsia: news.filter((n) => n.area === "asia").length,
      calendarCount: calendar.length,
      dataSource: marketSnapshot.source,
      rejectedReason: gate.reason,
      aiSkipped: true,
    };
  }

  const rawSignal = await generateSignal5m({ marketSnapshot, news, calendar });
  const signal = validateSignal(rawSignal, "atr5m");
  const saved = await insertSignal5m(signal);

  if (signal.direction === "BUY" || signal.direction === "SELL") {
    sendPushToAll({
      title: `Nuovo segnale veloce: ${signal.direction}`,
      body: `Entry ${signal.entry} · Confidence ${signal.confidence}%`,
      url: "/",
    }).catch((err) => console.error("[runAnalysis5m] invio push fallito:", err));
  }

  return {
    signalId: saved.id,
    direction: signal.direction,
    confidence: signal.confidence,
    xauusd: marketSnapshot.xauusd,
    atr5m: marketSnapshot.atr5m,
    rotturaInAtr: marketSnapshot.levels5m?.rotturaRialzoInAtr ?? null,
    stopAtrRatio: signal.stopAtrRatio ?? null,
    dxySource: marketSnapshot.dxySource,
    us10ySource: marketSnapshot.us10ySource,
    newsCount: news.length,
    newsAsia: news.filter((n) => n.area === "asia").length,
    calendarCount: calendar.length,
    dataSource: marketSnapshot.source,
    rejectedReason: signal.rejectedReason ?? null,
  };
}
