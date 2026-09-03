import {
  ensureSchema,
  insertSignal,
  insertMarketSnapshot,
  insertContextSnapshot,
  getLatestSignal,
  getSegnaleAttivo,
  getSegnaliInAttesa,
  attivaSegnale,
  scadeSegnaleInAttesa,
  closeSignal,
  isAiPaused,
  getSetting,
  setSetting,
  inserisciEventiSetup,
  inserisciContesto,
  getUltimoContesto,
  getEventiSetupAttivi,
  chiudiEventoSetup,
  salvaCandeleMemoria,
  pulisciCandeleMemoria,
} from "@/lib/server/db";
import { generateSignal, generaScenarioNotizia } from "@/lib/server/agent";
import { getMarketSnapshot, getCurrentPrice, isMarketOpen, type MarketSnapshot } from "@/lib/server/marketData";
import { metaApiFetchTimeSeries } from "@/lib/server/metaApiData";
import { getRelevantNews } from "@/lib/server/news";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { validateSignal } from "@/lib/server/validateSignal";
import { sendPushToAll } from "@/lib/server/pushSend";
import { shouldCallAI, hasTechnicalSetup } from "@/lib/server/aiGate";
import {
  rilevaEventi,
  motivoInvalidazione,
  eventoScaduto,
  zoneOccupateDalPrezzo,
  calcolaFingerprint,
  type EventoAttivo,
  type ZonaConTipo,
  type Timeframe,
  type Direzione,
} from "@/lib/server/setupState";
import {
  costruisciContesto,
  comprimiContesto,
  firmaContesto,
  calcolaTransizione,
  rilevaRangeAccumulo,
  type EventoContesto,
  type ContestoCompresso,
} from "@/lib/server/marketContext";

const SIGNAL_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// Quanto un segnale resta IN ATTESA che il prezzo torni sull'entry prima di
// essere abbandonato. Novanta minuti: oltre, il contesto che aveva prodotto
// il setup non e' piu' quello (gli eventi ICT hanno scadenze di 20-90 minuti,
// vedi setupState). Un segnale mai attivato non e' una perdita -- non e' mai
// stato un trade -- ma tenerlo vivo troppo a lungo significherebbe entrare su
// un'analisi vecchia.
const ATTESA_MASSIMA_MS = 90 * 60 * 1000;

// ---------------------------------------------------------------------------
// DISTANZA DELL'INGRESSO DAL PREZZO
//
// Il numero "entry" prodotto dalla strategia e' il bordo della zona di
// pullback (Order Block / FVG): e' un ORDINE PENDENTE, e quasi mai coincide
// con il prezzo dell'istante in cui parte la notifica. Entrare a mercato
// appena arriva la notifica significa prendere il lato sbagliato
// dell'impulso: si consuma gran parte dello stop prima che il trade vada
// dove deve, e il rapporto rischio/rendimento reale crolla rispetto a quello
// calcolato sull'entry.
//
// Qui non si cambia nessuna decisione: si misura soltanto quanto dista
// l'entry dal prezzo e se l'ordine e' ancora da raggiungere, gia' valido, o
// ormai superato. Serve a scriverlo nella notifica e in dashboard.
// ---------------------------------------------------------------------------

export type StatoIngresso = "eseguibile" | "in_attesa" | "superato";

export interface DistanzaIngresso {
  stato: StatoIngresso;
  distanza: number;
  distanzaInAtr: number | null;
  testo: string;
}

// Oltre questa distanza (in ATR) il pullback non e' piu' ragionevolmente
// raggiungibile: il prezzo se n'e' andato senza tornare indietro.
const INGRESSO_SUPERATO_ATR = 1;

export function distanzaIngresso(
  direzione: "BUY" | "SELL",
  entry: number,
  prezzo: number | null,
  atr: number | null
): DistanzaIngresso {
  if (prezzo === null || !Number.isFinite(prezzo) || !Number.isFinite(entry)) {
    return { stato: "in_attesa", distanza: 0, distanzaInAtr: null, testo: `Entry ${entry.toFixed(2)}` };
  }

  const distanza = Number(Math.abs(entry - prezzo).toFixed(2));
  const distanzaInAtr = atr !== null && atr > 0 ? Number((distanza / atr).toFixed(2)) : null;

  // Il limite e' gia' buono quando il prezzo lo ha raggiunto o superato dal
  // lato favorevole: sotto l'entry per un BUY, sopra per un SELL.
  const raggiunto = direzione === "BUY" ? prezzo <= entry : prezzo >= entry;
  if (raggiunto) {
    return {
      stato: "eseguibile",
      distanza,
      distanzaInAtr,
      testo: `Entry ${entry.toFixed(2)} · eseguibile ora (prezzo ${prezzo.toFixed(2)})`,
    };
  }

  const troppoLontano = distanzaInAtr !== null && distanzaInAtr > INGRESSO_SUPERATO_ATR;
  if (troppoLontano) {
    return {
      stato: "superato",
      distanza,
      distanzaInAtr,
      testo: `Entry ${entry.toFixed(2)} · prezzo gia' a ${prezzo.toFixed(2)}, ${distanza} oltre (${distanzaInAtr} ATR) — pullback probabilmente saltato`,
    };
  }

  return {
    stato: "in_attesa",
    distanza,
    distanzaInAtr,
    testo: `Entry ${entry.toFixed(2)} · PENDENTE, prezzo ${prezzo.toFixed(2)} (${distanza}${
      distanzaInAtr !== null ? ` · ${distanzaInAtr} ATR` : ""
    }) — non entrare a mercato`,
  };
}

// Forma minima di una candela grezza cosi' come arriva da marketData.ts
// (stringhe numeriche, indice 0 = candela in formazione). Serve solo qui,
// per il blocco di persistenza della memoria candele.
interface CandelaGrezza {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
}

// Il controllo tecnico gira a ogni ciclo (anche ogni minuto). Questi limiti
// riguardano SOLO le scritture e le chiamate a pagamento, non il monitoraggio.
// - l'AI non viene chiamata due volte a meno di un minuto di distanza
// - lo snapshot di mercato si persiste al massimo ogni 5 minuti
const INTERVALLO_MINIMO_AI_MS = 60 * 1000;
const INTERVALLO_SNAPSHOT_MS = 5 * 60 * 1000;
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
  tp1: number
): Promise<"WIN" | "LOSS" | null> {
  const candele = await metaApiFetchTimeSeries("5min", 60);
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

// AVVISO NOTIZIA CON LIVELLI PRONTI
//
// Perche' un avviso e non un segnale: il percorso cron -> OpenAI -> push ->
// telefono -> esecuzione manuale costa minuti, e il primo impulso su un dato
// macro dura secondi. Un segnale generato alle 16:00 arriva quando il
// movimento e' finito, e allo spread allargato del momento si compra il
// massimo pagando il pedaggio.
//
// L'unico modo di prendere il primo movimento e' avere gli ordini GIA' sul
// book. Percio' l'avviso parte in anticipo (T-15/T-5) e porta con se' i due
// livelli: sopra l'estremo dell'ultima ora piu' un cuscinetto, sotto lo
// stesso al contrario. Si piazzano buy stop e sell stop e si aspetta il dato.
//
// Parte una volta sola per evento.
const ANTICIPO_MAX_MIN = 15;
const ANTICIPO_MIN_MIN = 4;
// Cuscinetto oltre l'estremo, in ATR del 15 minuti: serve a non farsi
// innescare dal semplice allargamento dello spread al momento dell'uscita.
const CUSCINETTO_ATR = 0.35;
// Candele da 5 minuti che compongono il range di riferimento (ultima ora).
const CANDELE_RANGE = 12;

// Finestra in cui lo scenario viene preparato: abbastanza presto da essere
// pronto quando parte l'avviso, abbastanza tardi da vedere il contesto vero.
const SCENARIO_DA_MIN = 60;
const SCENARIO_A_MIN = 12;
// Uno scenario resta valido per tutta la vita dell'evento piu' un'ora dopo:
// serve anche DOPO l'uscita, per capire quale ramo si e' verificato.
const SCENARIO_VALIDO_DOPO_MIN = 60;

interface ScenarioSalvato {
  chiave: string;
  eventoTs: string;
  mappa: unknown;
}

// Prepara la mappa di reazione una volta sola per evento e la salva. Una
// chiamata OpenAI in piu' per ogni dato importante, non per ogni ciclo.
async function preparaScenario(
  calendar: { title: string; country: string; impact: string; time: string }[],
  snapshot: MarketSnapshot,
  news: unknown,
  adesso: number
): Promise<void> {
  if (!Array.isArray(calendar)) return;

  const prossimo = calendar
    .map((e) => ({ e, ts: new Date(e.time).getTime() }))
    .filter(({ e, ts }) => {
      if (!Number.isFinite(ts) || e.impact !== "high") return false;
      const minuti = (ts - adesso) / 60000;
      return minuti <= SCENARIO_DA_MIN && minuti >= SCENARIO_A_MIN;
    })
    .sort((a, b) => a.ts - b.ts)[0];
  if (!prossimo) return;

  const chiave = `${prossimo.e.title}|${prossimo.e.time}`;
  const salvato = await getSetting("scenario_notizia");
  if (salvato) {
    try {
      if ((JSON.parse(salvato) as ScenarioSalvato).chiave === chiave) return;
    } catch {
      // valore corrotto: si rigenera
    }
  }

  try {
    const mappa = await generaScenarioNotizia({ evento: prossimo.e, marketSnapshot: snapshot, news });
    const record: ScenarioSalvato = {
      chiave,
      eventoTs: new Date(prossimo.ts).toISOString(),
      mappa,
    };
    await setSetting("scenario_notizia", JSON.stringify(record));
  } catch (err) {
    // Uno scenario mancante non deve fermare il ciclo: l'analisi prosegue
    // senza, esattamente come faceva prima.
    console.error("[runAnalysis] scenario notizia fallito:", err);
  }
}

// Recupera lo scenario se ancora pertinente, per infilarlo nel payload AI.
async function scenarioCorrente(adesso: number): Promise<unknown> {
  const salvato = await getSetting("scenario_notizia");
  if (!salvato) return null;
  try {
    const record = JSON.parse(salvato) as ScenarioSalvato;
    const ts = new Date(record.eventoTs).getTime();
    if (!Number.isFinite(ts)) return null;
    if (adesso > ts + SCENARIO_VALIDO_DOPO_MIN * 60 * 1000) return null;
    return record.mappa;
  } catch {
    return null;
  }
}

async function avvisaNotizia(
  calendar: { title: string; country: string; impact: string; time: string }[],
  snapshot: MarketSnapshot,
  adesso: number
): Promise<boolean> {
  if (!Array.isArray(calendar) || calendar.length === 0) return false;

  const imminente = calendar
    .map((e) => ({ e, ts: new Date(e.time).getTime() }))
    .filter(({ e, ts }) => {
      if (!Number.isFinite(ts)) return false;
      if (e.impact !== "high" && e.impact !== "medium") return false;
      const minuti = (ts - adesso) / 60000;
      return minuti <= ANTICIPO_MAX_MIN && minuti >= ANTICIPO_MIN_MIN;
    })
    .sort((a, b) => a.ts - b.ts)[0];
  if (!imminente) return false;

  const chiave = `${imminente.e.title}|${imminente.e.time}`;
  const gia = await getSetting("notizia_avvisata");
  if (gia === chiave) return false;
  await setSetting("notizia_avvisata", chiave);

  const minuti = Math.round((imminente.ts - adesso) / 60000);
  const atr = snapshot.atr15m ?? null;
  const prezzo = snapshot.xauusd;

  // Range dell'ultima ora dalle candele da 5 minuti gia' chiuse.
  const c5 = Array.isArray(snapshot.candles?.["5m"]) ? snapshot.candles["5m"] : [];
  const finestra = c5.slice(1, 1 + CANDELE_RANGE);
  const massimi = finestra.map((c) => Number(c.high)).filter(Number.isFinite);
  const minimi = finestra.map((c) => Number(c.low)).filter(Number.isFinite);

  let livelli = "";
  if (massimi.length >= 3 && minimi.length >= 3 && atr !== null && atr > 0) {
    const cuscinetto = atr * CUSCINETTO_ATR;
    const sopra = Math.max(...massimi) + cuscinetto;
    const sotto = Math.min(...minimi) - cuscinetto;
    livelli = ` Buy stop ${sopra.toFixed(2)} · Sell stop ${sotto.toFixed(2)} (range ultima ora + ${cuscinetto.toFixed(2)}).`;
  }

  sendPushToAll({
    title: `Fra ${minuti} min: ${imminente.e.title}`,
    body: `${imminente.e.country}, impatto ${imminente.e.impact}. Prezzo ${
      prezzo !== null ? prezzo.toFixed(2) : "n/d"
    }.${livelli} Piazza gli ordini ORA: dopo l'uscita e' tardi.`,
    url: "/",
    tag: "notizia-imminente",
  }).catch((err) => console.error("[runAnalysis] avviso notizia fallito:", err));

  return true;
}

// Avviso di GESTIONE a +1R.
//
// Sui dati reali il TP1 arriva in media dopo 1h40, ma con una coda lunga: dei
// venti trade che l'hanno raggiunto, otto entro un'ora, tredici entro due,
// venti entro quattro. Chiudere a mano dopo un'ora taglia piu' della meta'
// dei vincitori -- ed e' esattamente quello che succedeva, perche' l'attesa
// avveniva a rischio pieno.
//
// Portare lo stop a pareggio dopo un parziale rende l'attesa gratuita: da li'
// in poi il trade non puo' piu' perdere, e le ore successive non costano
// niente. L'esecuzione e' manuale (l'app non manda ordini al broker): questo
// e' solo l'avviso che il livello e' stato raggiunto.
//
// Parte una volta sola per segnale. Non serve nessuna guardia sull'ingresso:
// arrivare a +1R implica che il prezzo ha gia' superato l'entry.
const SOGLIA_PARZIALE_R = 1;

async function avvisaParziale(
  segnale: { id: string | number; direction: string; entry: unknown; stop_loss: unknown; tp1: unknown },
  prezzo: number | null
): Promise<boolean> {
  if (prezzo === null || !Number.isFinite(prezzo)) return false;
  if (segnale.direction !== "BUY" && segnale.direction !== "SELL") return false;

  const entry = Number(segnale.entry);
  const stopLoss = Number(segnale.stop_loss);
  const rischio = Math.abs(entry - stopLoss);
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || rischio <= 0) return false;

  const guadagnoR =
    (segnale.direction === "BUY" ? prezzo - entry : entry - prezzo) / rischio;
  if (guadagnoR < SOGLIA_PARZIALE_R) return false;

  const gia = await getSetting("parziale_avvisato_signal_id");
  if (gia === String(segnale.id)) return false;
  await setSetting("parziale_avvisato_signal_id", String(segnale.id));

  sendPushToAll({
    title: `+${guadagnoR.toFixed(1)}R · chiudi meta' e stop a pareggio`,
    body: `${segnale.direction} da ${entry.toFixed(2)}, prezzo ${prezzo.toFixed(2)}. Sposta lo stop a ${entry.toFixed(
      2
    )}: da qui in poi il trade non puo' piu' perdere. TP1 ${Number(segnale.tp1).toFixed(2)}.`,
    url: "/",
    tag: "parziale-1r",
  }).catch((err) => console.error("[runAnalysis] avviso parziale fallito:", err));

  return true;
}

export async function runAnalysis(options?: { force?: boolean }) {
  const force = options?.force ?? false;

  if (!isMarketOpen()) {
    return { skipped: true, reason: "market_closed" };
  }

  await ensureSchema();

  // MODALITA' SONNO — la pausa NON ferma il monitor.
  // Il monitor (candele chiuse, eventi di struttura, contesto, snapshot)
  // continua a girare anche in pausa: e' cosi' che al risveglio l'AI ritrova
  // la memoria completa invece di un buco. Il blocco vero e' piu' in basso,
  // subito prima della chiamata a pagamento.
  const inPausa = await isAiPaused();
  const daRisvegliare =
    !inPausa && (await getSetting("ai_refresh_al_risveglio")) === "true";

  // ============ SEGNALI IN ATTESA: attivazione al tocco dell'entry ========
  //
  // Un segnale nasce IN ATTESA e non manda notifiche. Qui, a ogni ciclo, si
  // guarda se il prezzo ha toccato la sua entry: in quel momento diventa un
  // trade vero, parte l'unica notifica e comincia il monitoraggio di stop e
  // target. Se il prezzo non ci arriva entro ATTESA_MASSIMA_MS il segnale
  // muore senza aver mai disturbato nessuno.
  //
  // L'attesa si misura dalla creazione; l'esito dal momento dell'attivazione,
  // altrimenti un trade partito dopo un'ora risulterebbe vecchio di un'ora.
  // Prezzo letto UNA volta per ciclo e riusato: lo servono sia il blocco di
  // attivazione qui sotto sia il monitor del trade attivo. Due chiamate
  // separate avrebbero potuto anche restituire valori diversi, con un segnale
  // attivato a un prezzo e valutato a un altro.
  let prezzoCiclo: number | null = null;
  const inAttesa = await getSegnaliInAttesa();
  // Quanti restano in attesa DOPO questo ciclo: quelli appena attivati o
  // scaduti non contano piu'. Serve per il blocco poco piu' sotto, che
  // altrimenti userebbe la fotografia scattata prima degli aggiornamenti.
  let restanoInAttesa = 0;
  if (inAttesa.length > 0) {
    prezzoCiclo = await getCurrentPrice();
    const prezzoOra = prezzoCiclo;
    for (const att of inAttesa) {
      const eEntry = Number(att.entry);
      // Isolato per singolo segnale: se il DB fallisce (timeout,
      // disconnessione) non deve interrompere l'intero ciclo -- il
      // monitoraggio del trade attivo e la generazione di nuovi segnali
      // devono proseguire comunque. Si riprova al ciclo successivo.
      try {
        const scadutaAttesa = Date.now() - new Date(att.created_at).getTime() > ATTESA_MASSIMA_MS;

        const toccata =
          prezzoOra !== null && Number.isFinite(eEntry)
            ? att.direction === "BUY"
              ? prezzoOra <= eEntry
              : prezzoOra >= eEntry
            : false;

        if (toccata) {
          // Il prezzo puo' aver attraversato entry E stop nello stesso salto:
          // in quel caso il trade nascerebbe gia' perso. Stessa cosa se ha
          // superato anche il target, che lo chiuderebbe come WIN a pieno R
          // senza essere mai stato vivo. In entrambi i casi non si attiva e non
          // parte nessuna notifica: il segnale muore com'e' nato, a zero.
          const eStop = Number(att.stop_loss);
          const eTp1 = Number(att.tp1);
          const oltreStop =
            Number.isFinite(eStop) && (att.direction === "BUY" ? prezzoOra! <= eStop : prezzoOra! >= eStop);
          const oltreTarget =
            Number.isFinite(eTp1) && (att.direction === "BUY" ? prezzoOra! >= eTp1 : prezzoOra! <= eTp1);

          if (oltreStop || oltreTarget) {
            await scadeSegnaleInAttesa(
              att.id,
              `\n\n[Mai attivato: al tocco dell'entry ${eEntry.toFixed(2)} il prezzo era gia' ` +
                `${prezzoOra!.toFixed(2)}, oltre ${oltreStop ? `lo stop ${eStop.toFixed(2)}` : `il target ${eTp1.toFixed(2)}`}. ` +
                `Il trade sarebbe nato gia' chiuso: nessuna notifica inviata.]`
            );
            console.log(
              `[runAnalysis] segnale ${att.id} non attivato: prezzo ${prezzoOra!.toFixed(2)} oltre ${
                oltreStop ? "lo stop" : "il target"
              }`
            );
            continue;
          }

          await attivaSegnale(att.id);
          const prezzoTesto = prezzoOra !== null ? prezzoOra.toFixed(2) : "n/d";
          sendPushToAll({
            title: `${att.direction} · prezzo ${prezzoTesto}`,
            body: `Entry ${eEntry.toFixed(2)} · SL ${Number(att.stop_loss).toFixed(2)} · TP1 ${Number(
              att.tp1
            ).toFixed(2)} · TP2 ${Number(att.tp2).toFixed(2)} · Conf ${Number(att.confidence)}%`,
            url: "/",
          }).catch((err) => console.error("[runAnalysis] invio push attivazione fallito:", err));
          console.log(`[runAnalysis] segnale ${att.id} attivato a ${prezzoTesto}`);
          continue;
        }

        if (!scadutaAttesa) {
          restanoInAttesa += 1;
          continue;
        }

        {
          await scadeSegnaleInAttesa(
            att.id,
            `\n\n[Mai attivato: il prezzo non e' tornato sull'entry ${eEntry.toFixed(2)} entro ` +
              `${Math.round(ATTESA_MASSIMA_MS / 60000)} minuti. Nessun trade e' stato aperto.]`
          );
        }
      } catch (err) {
        console.error(`[runAnalysis] attivazione/scadenza fallita per il segnale ${att.id}:`, err);
      }
    }
  }
  // ============ fine attivazione ==========================================

  // Da qui in poi si segue SOLO il trade gia' attivato: quelli in attesa non
  // sono trade e non bloccano la generazione di nuovi segnali.
  const latest = await getSegnaleAttivo();

  // Un segnale ANCORA IN ATTESA blocca la generazione esattamente come un
  // trade aperto. Senza questo, ogni ciclo ne creerebbe uno nuovo e se ne
  // accumulerebbero decine: al primo movimento partirebbero notifiche a
  // raffica e il monitor ne seguirebbe comunque uno solo.
  const attesaPendente = restanoInAttesa > 0;

  const hasOpenTrade =
    (latest && (latest.direction === "BUY" || latest.direction === "SELL") && !latest.outcome) ||
    attesaPendente;

  let currentPrice: number | null = null;
  let naturalOutcome: "WIN" | "LOSS" | null = null;
  // Alzato quando c'e' un trade aperto da seguire: l'uscita non avviene
  // piu' dentro il blocco di monitoraggio, ma dopo che il monitor ha finito.
  let tradeAttivoDaSeguire = false;
  let entry = 0;
  let stopLoss = 0;
  let tp1 = 0;
  let risk = 0;

  let expired = false;

  if (hasOpenTrade && latest) {
    currentPrice = prezzoCiclo ?? (await getCurrentPrice());
    entry = Number(latest.entry);
    stopLoss = Number(latest.stop_loss);
    tp1 = Number(latest.tp1);
    risk = Math.abs(entry - stopLoss);

    // Prima fonte: le candele dall'apertura del trade in poi.
    // Le candele si leggono dall'ATTIVAZIONE, non dalla creazione: il trade
    // esiste da quando il prezzo ha toccato l'entry. Contare da created_at
    // farebbe vedere movimenti avvenuti quando il trade non era ancora vivo,
    // e chiuderebbe come WIN o LOSS cose mai accadute.
    naturalOutcome = await esitoDalleCandele(
      latest.direction,
      latest.attivato_il ?? latest.created_at,
      stopLoss,
      tp1
    );

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
      // Il prezzo non ha ancora toccato ne' stop ne' target: e' esattamente
      // la finestra in cui puo' arrivare sulla zona di ingresso. Il controllo
      // gira a ogni ciclo, quindi l'avviso parte al primo passaggio utile.
      await avvisaParziale(latest, currentPrice);

      // Anche la durata massima parte dall'attivazione: un trade che ha
      // aspettato un'ora prima di partire ha comunque le sue 4 ore di vita.
      const ageMs = Date.now() - new Date(latest.attivato_il ?? latest.created_at).getTime();
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
        // Il trade e' ancora vivo: nessun segnale nuovo da generare, ma il
        // ciclo NON esce qui. Prima usciva, e per tutta la durata del trade
        // -- fino a 4 ore -- memoria candele, eventi di struttura e contesto
        // restavano fermi: alla chiusura l'analisi ripartiva da un buco.
        //
        // Qui si alza solo un flag; l'uscita vera avviene piu' in basso,
        // dopo il monitor, insieme a quelle per l'attesa e per la pausa.
        //
        // Spariva anche uno spreco: qui si scaricava e salvava uno snapshot
        // apposta, mentre il flusso normale lo fa comunque poco piu' sotto.
        // Era una chiamata di rete in piu' a ogni ciclo di ogni trade.
        tradeAttivoDaSeguire = true;
      }
    }
  }

  // NOTA: il controllo sui segnali IN ATTESA non sta qui, ma piu' in basso
  // insieme a quello della modalita' sonno (cerca "signal_pending").
  //
  // Prima era qui, prima di getMarketSnapshot: serviva a impedire che l'AI
  // generasse un secondo segnale mentre il primo aspettava ancora il suo
  // prezzo, e quello continua a funzionare. Ma uscire cosi' presto
  // significava anche che per un massimo di 90 minuti il sistema smetteva di
  // aggiornare candele chiuse, eventi di struttura e contesto -- lo stesso
  // buco che la modalita' sonno era stata scritta per evitare. Non si era
  // mai visto perche' nessun segnale restava davvero in attesa: la
  // migrazione di attivato_il li attivava tutti d'ufficio.
  //
  // Ora il monitor gira sempre fino in fondo, e l'attesa ferma soltanto la
  // parte a pagamento, esattamente come la pausa.

  const marketSnapshot = await getMarketSnapshot();

  // ================ MEMORIA CANDELE (solo infrastruttura) =================
  // Persistenza pura delle candele CHIUSE M30/M15/M5 su Neon (tabella
  // candle_memory, separata da market_snapshots.raw). Non legge questa
  // memoria nessuna parte della strategia o del payload AI: e' solo
  // l'infrastruttura per renderle rileggibili in futuro. Un fallimento qui
  // non deve mai interrompere il ciclo di analisi.
  try {
    const soleChiuse = (candele: CandelaGrezza[] | undefined) =>
      (candele ?? [])
        .slice(1) // indice 0 = candela ancora in formazione, esclusa
        .map((c) => ({
          datetime: new Date(c.datetime).toISOString(),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }))
        .filter(
          (c) =>
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close) &&
            Number.isFinite(new Date(c.datetime).getTime())
        );

    await salvaCandeleMemoria("M30", soleChiuse(marketSnapshot.candles["30m"]));
    await salvaCandeleMemoria("M15", soleChiuse(marketSnapshot.candles["15m"]));
    await salvaCandeleMemoria("M5", soleChiuse(marketSnapshot.candles["5m"]));
    await pulisciCandeleMemoria();
  } catch (err) {
    console.error("[runAnalysis] memoria candele M30/M15/M5 fallita:", err);
  }
  // ================ fine MEMORIA CANDELE ====================================

  // Attenzione a "latest": hasOpenTrade ora e' vero anche quando c'e' solo un
  // segnale IN ATTESA, e in quel caso latest e' null. Qui serve il trade
  // ATTIVO, quindi si controlla latest esplicitamente invece di fidarsi del
  // flag: senza, un "Chiudi e rigenera" con solo un segnale in attesa
  // andrebbe in errore su latest!.id.
  if (latest && !naturalOutcome && !expired && force) {
    // Prima qui si registrava sempre 0: 21 dei 24 "BREAKEVEN" erano in realta'
    // trade interrotti a meta' volo, in media dopo 21 minuti, e falsavano meta'
    // del campione. Ora si registra il risultato reale al momento del click,
    // come gia' avviene alla scadenza delle 4 ore.
    const resultR =
      currentPrice !== null && risk > 0
        ? Number(
            ((latest.direction === "BUY" ? currentPrice - entry : entry - currentPrice) / risk).toFixed(2)
          )
        : 0;
    const note =
      currentPrice === null
        ? "\n\n[Chiuso manualmente: nuova generazione richiesta dall'utente, prezzo attuale non verificabile, risultato non misurabile.]"
        : "\n\n[Chiuso manualmente: sostituito da una nuova generazione richiesta dall'utente. Risultato reale " + resultR + "R al momento della chiusura.]";
    await closeSignal(latest.id, "BREAKEVEN", resultR, note);
  }

  // Anche i segnali IN ATTESA vanno chiusi quando si forza una nuova
  // generazione: sono setup vecchi che aspettano un prezzo, e lasciarli vivi
  // significherebbe vederli attivare piu' tardi accanto al segnale nuovo.
  // Chiusi a 0R perche' non sono mai stati trade.
  if (force && restanoInAttesa > 0) {
    for (const att of inAttesa) {
      if (att.outcome) continue;
      await scadeSegnaleInAttesa(
        att.id,
        "\n\n[Mai attivato: annullato da una nuova generazione richiesta dall'utente.]"
      );
    }
  }

  // ======================= MONITOR (gira a ogni ciclo) ====================
  // Nessuna AI qui dentro: si aggiorna solo la memoria degli eventi tecnici.

  // 1) nuovi eventi sulle candele CHIUSE, registrati una volta sola
  // M30 non e' piu' un timeframe di analisi (impianto H4/H1 -> M15 -> M5):
  // i suoi eventi non vengono piu' generati. Le righe M30 gia' in tabella
  // restano leggibili e si estinguono per scadenza, come gia' avviene per H1.
  const eventiRilevati = [
    ...rilevaEventi(marketSnapshot.candles["15m"], marketSnapshot.atr15m, "M15"),
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
    // "H1" non viene piu' generato, ma in tabella possono esserci righe H1
    // ancora ACTIVE dai cicli precedenti: vanno lette sulle candele orarie
    // finche' non si invalidano o scadono da sole.
    const candele =
      evento.timeframe === "H1"
        ? marketSnapshot.candles["1h"]
        : evento.timeframe === "M30"
          ? marketSnapshot.candles["30m"]
          : evento.timeframe === "M15"
            ? marketSnapshot.candles["15m"]
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
      atr30m: marketSnapshot.atr30m,
      atr15m: marketSnapshot.atr15m,
      atr5m: marketSnapshot.atr5m,
      liquidita24h: marketSnapshot.liquidita24h,
      zoneM15: {
        orderBlocks: marketSnapshot.ictOrderBlocksM15,
        fvg: marketSnapshot.ictFvgM15,
        livelliUguali: marketSnapshot.ictLivelliUgualiM15,
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
      m30: { regime: contesto.m30.regime, fase: contesto.m30.fase },
      m15: { regime: contesto.m15.regime, fase: contesto.m15.fase },
      m5: { regime: contesto.m5.regime, fase: contesto.m5.fase },
      prezzo: contesto.prezzo,
      aggiornatoIl: contesto.aggiornatoIl,
    })
  );

  // 6) impronta del setup
  // Le zone vengono etichettate con timeframe/tipo/direzione PRIMA del
  // controllo "il prezzo e' dentro?": la fingerprint deve poter distinguere
  // "dentro l'Order Block M30 ribassista 2375-2371" da "dentro la FVG M15
  // rialzista 2360-2358", non solo sapere che e' "dentro una zona qualsiasi".
  // Copre M15 e M5 (M30 non guida piu' il setup).
  const tagZone = (
    timeframe: Timeframe,
    tipo: "orderBlock" | "fvg",
    zone: { direzione: string; top: number; bottom: number }[] | undefined
  ): ZonaConTipo[] =>
    (zone ?? []).map((z) => ({
      timeframe,
      tipo,
      direzione: z.direzione as Direzione,
      top: z.top,
      bottom: z.bottom,
    }));

  const zoneOccupate = zoneOccupateDalPrezzo(marketSnapshot.xauusd, [
    tagZone("M15", "orderBlock", marketSnapshot.ictOrderBlocksM15),
    tagZone("M15", "fvg", marketSnapshot.ictFvgM15),
    tagZone("M5", "orderBlock", marketSnapshot.ictOrderBlocksM5),
    tagZone("M5", "fvg", marketSnapshot.ictFvgM5),
  ]);
  // ATR di riferimento: M15, il timeframe di setup. Era atr30m, rimasto da
  // quando M30 guidava: l'impronta decide se chiamare l'AI, quindi la scala
  // con cui misura le distanze deve essere quella del timeframe che conta.
  const impronta = calcolaFingerprint(
    eventiAttivi,
    marketSnapshot.xauusd,
    marketSnapshot.atr15m,
    zoneOccupate
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
  // Al risveglio si forza sempre un giro completo: durante la pausa la
  // fingerprint ha continuato ad aggiornarsi, quindi senza questa eccezione
  // il ciclo direbbe "setup invariato" e non chiamerebbe mai l'AI.
  if (!force && !daRisvegliare && !improntaCambiata && chiusiOra.length === 0) {
    return {
      skipped: true,
      reason: "setup_invariato",
      eventiAttivi: eventiAttivi.length,
      zoneOccupate: zoneOccupate.length,
      contesto: {
        m30: { regime: contesto.m30.regime, fase: contesto.m30.fase },
        m15: { regime: contesto.m15.regime, fase: contesto.m15.fase },
        m5: { regime: contesto.m5.regime, fase: contesto.m5.fase },
      },
      segnaleRiusato: await getSetting("setup_last_signal_id"),
      controllatoIl: new Date().toISOString(),
    };
  }

  await setSetting("setup_fingerprint", impronta);
  // ====================== fine MONITOR ===================================

  // Da qui in poi si spendono soldi: news, calendario e chiamata AI.
  // In pausa il ciclo si ferma esattamente qui, con il monitor gia' aggiornato.
  //
  // Le tre uscite qui sotto condividono la stessa logica: c'e' una ragione
  // per non generare un segnale nuovo, ma il monitor deve aver finito il suo
  // lavoro prima di fermarsi -- cosi' quando la ragione viene meno l'analisi
  // riparte da un quadro completo invece che da un buco.
  //
  // Un trade APERTO e' la prima: finche' e' vivo non serve un altro segnale,
  // e puo' restare vivo fino a 4 ore.
  if (tradeAttivoDaSeguire && latest) {
    return {
      skipped: true,
      reason: "signal_active",
      activeSignalId: latest.id,
      direction: latest.direction,
      entry: currentPrice !== null ? entry : Number(latest.entry),
      currentPrice: currentPrice ?? undefined,
      monitorAggiornato: true,
      eventiAttivi: eventiAttivi.length,
      zoneOccupate: zoneOccupate.length,
      controllatoIl: new Date().toISOString(),
    };
  }

  // Un segnale IN ATTESA si ferma nello stesso punto e per la stessa
  // ragione: finche' quel segnale non si attiva o non scade non ha senso
  // generarne un altro, ma il monitor deve continuare a lavorare.
  if (attesaPendente && !force) {
    return {
      skipped: true,
      reason: "signal_pending",
      note: "Un segnale e' in attesa che il prezzo tocchi l'entry: nessuna nuova generazione finche' non si attiva o scade.",
      monitorAggiornato: true,
      eventiAttivi: eventiAttivi.length,
      zoneOccupate: zoneOccupate.length,
      controllatoIl: new Date().toISOString(),
    };
  }

  if (inPausa) {
    return {
      skipped: true,
      reason: "ai_paused",
      monitorAggiornato: true,
      eventiAttivi: eventiAttivi.length,
      zoneOccupate: zoneOccupate.length,
      contesto: {
        m30: { regime: contesto.m30.regime, fase: contesto.m30.fase },
        m15: { regime: contesto.m15.regime, fase: contesto.m15.fase },
        m5: { regime: contesto.m5.regime, fase: contesto.m5.fase },
      },
      inPausaDal: await getSetting("ai_paused_at"),
      controllatoIl: new Date().toISOString(),
    };
  }

  // Risveglio consumato: il refresh forzato vale una volta sola.
  if (daRisvegliare) {
    await setSetting("ai_refresh_al_risveglio", "false");
  }

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

  // FINESTRA NOTIZIE: nei minuti intorno a un dato macro ad alto impatto il
  // grafico non e' leggibile con la logica ICT. Quella candela ampia col corpo
  // pieno non e' un displacement su liquidita': e' la reazione al dato, e i
  // primi minuti sono tipicamente uno stop hunt in entrambe le direzioni.
  //
  // Il controllo sta PRIMA del filtro tecnico e della chiamata AI: nessun
  // segnale e nessun costo OpenAI. Il monitor pero' continua a girare, quindi
  // candele, eventi e contesto restano aggiornati e al primo ciclo dopo la
  // finestra l'analisi riparte da un quadro completo.
  //
  // Nemmeno la generazione manuale (force) forza il passaggio: se stai
  // premendo il pulsante trenta secondi prima dell'ISM, e' proprio la volta in
  // cui non conviene.
  // NOTIZIE: l'avviso NON blocca la generazione. Scelta esplicita -- si vuole
  // poter operare anche a ridosso del dato. Quello che parte e' un avviso con
  // i due livelli gia' calcolati, in tempo utile per piazzare gli ordini
  // PRIMA dell'uscita (vedi avvisaNotizia).
  await preparaScenario(calendar, marketSnapshot, news, adesso);
  await avvisaNotizia(calendar, marketSnapshot, adesso);

  // Zona di accumulo sul 5 minuti: il prezzo chiuso da due ore in una fascia
  // stretta rispetto all'ATR. Le rotture strutturali sui timeframe che contano
  // (H1 narrativa, M15 setup) spengono il filtro, perche' dicono che la fascia
  // si sta gia' aprendo. M30 non compare piu': non e' un timeframe di analisi.
  const rangeAccumulo = rilevaRangeAccumulo(
    marketSnapshot.xauusd,
    marketSnapshot.candles?.["5m"] as { high: unknown; low: unknown }[] | undefined,
    marketSnapshot.atr5m ?? null,
    [
      { timeframe: "H1", evento: marketSnapshot.ictStrutturaH1?.evento ?? null },
      { timeframe: "M15", evento: marketSnapshot.ictStrutturaM15?.evento ?? null },
    ]
  );

  // Filtro tecnico locale: se non c'e' nulla di interessante sul grafico non
  // chiamiamo l'AI (risparmio credito). La generazione manuale (force) passa
  // sempre, e il ciclo viene comunque registrato come NO_TRADE con la ragione.
  const setupTecnico = hasTechnicalSetup(
    { ...marketSnapshot, rangeAccumulo },
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
    scenario: await scenarioCorrente(adesso),
  });
  let signal = validateSignal(rawSignal);

  // OGNI SEGNALE GENERATO VIENE INVIATO (02/09).
  //
  // Per qualche ora i segnali con entry non ancora raggiunta venivano
  // scartati. Scelta rivista: l'entry di un setup ICT e' il bordo della zona
  // di pullback, quindi un ordine limite e' il comportamento normale del
  // metodo, non un difetto. E i dati lo confermavano: i trade con entry oltre
  // uno stop di distanza avevano fatto 7 vincite su 4 perdite (+11.72R).
  // Scartarli buttava via trade buoni; il problema vero era la notifica, che
  // diceva "eseguibile ora" anche quando non lo era -- ed e' li' che si
  // risolve, nel titolo del push.
  //
  // RESTA il controllo sui trade nati gia' morti, che veniva da un bug vero:
  // un segnale il cui stop o target sono GIA' stati superati dal prezzo non
  // e' un ordine pendente, e' un trade che nascerebbe perso (o gia' vinto
  // senza essere mai esistito, gonfiando le statistiche). Quelli restano
  // NO_TRADE.
  if (signal.direction === "BUY" || signal.direction === "SELL") {
    const prezzoOra = marketSnapshot.xauusd;
    const entrySegnale = Number(signal.entry);
    const stopSegnale = Number(signal.stopLoss);
    const tp1Segnale = Number(signal.tp1);

    let motivoScarto = "";
    if (Number.isFinite(prezzoOra) && Number.isFinite(stopSegnale) && Number.isFinite(entrySegnale)) {
      if (signal.direction === "BUY" ? prezzoOra <= stopSegnale : prezzoOra >= stopSegnale) {
        motivoScarto = `il prezzo ${Number(prezzoOra).toFixed(2)} ha gia' superato lo stop ${stopSegnale.toFixed(2)}: il trade nascerebbe gia' perso`;
      } else if (
        Number.isFinite(tp1Segnale) &&
        (signal.direction === "BUY" ? prezzoOra >= tp1Segnale : prezzoOra <= tp1Segnale)
      ) {
        motivoScarto = `il prezzo ${Number(prezzoOra).toFixed(2)} ha gia' raggiunto il target ${tp1Segnale.toFixed(2)}: non resta niente da prendere`;
      }
    }

    if (motivoScarto) {
      signal = validateSignal({
        ...rawSignal,
        direction: "NO_TRADE",
        entry: 0,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        riskReward: 0,
        reasoning: `${rawSignal.reasoning ?? ""}\n\n[Scartato: il segnale ${signal.direction} aveva entry ${entrySegnale.toFixed(2)} — ${motivoScarto}.]`,
      } as typeof rawSignal);
    }
  }

  const saved = await insertSignal(signal);
  await setSetting("setup_last_signal_id", saved.id);

  if (signal.direction === "BUY" || signal.direction === "SELL") {
    // NOTIFICA IMMEDIATA ALLA NASCITA (03/09) -- sistema pendente RIMOSSO.
    //
    // Per un giorno il segnale nasceva IN ATTESA e la notifica partiva solo
    // al tocco dell'entry. L'intento era non registrare come vinti o persi
    // trade mai eseguiti, ma il rimedio era peggiore del male: un segnale in
    // attesa bloccava la generazione di nuovi segnali, e il sistema e'
    // rimasto muto 75 minuti mentre il prezzo si muoveva di 18 dollari nella
    // direzione opposta.
    //
    // Chi opera con ordini limite non ha bisogno di quell'attesa: ricevere
    // subito entry, stop e target permette di piazzare l'ordine sul broker e
    // lasciare che sia lui ad aspettare il prezzo. Il segnale nasce quindi
    // gia' attivo (attivato_il e' scritto dentro l'INSERT, vedi
    // insertSignal) e la notifica parte adesso.
    const prezzoOra = Number(marketSnapshot.xauusd);
    sendPushToAll({
      title: `${signal.direction} · prezzo ${prezzoOra.toFixed(2)}`,
      body: `Entry ${Number(signal.entry).toFixed(2)} · SL ${Number(signal.stopLoss).toFixed(
        2
      )} · TP1 ${Number(signal.tp1).toFixed(2)} · TP2 ${Number(signal.tp2).toFixed(
        2
      )} · Conf ${signal.confidence}%`,
      url: "/",
    }).catch((err) => console.error("[runAnalysis] invio push fallito:", err));

    console.log(
      `[runAnalysis] segnale ${saved.id} creato e notificato: ${signal.direction} entry ${Number(
        signal.entry
      ).toFixed(2)}, prezzo ${prezzoOra.toFixed(2)}`
    );
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

