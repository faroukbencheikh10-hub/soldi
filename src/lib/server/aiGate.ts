// Eccezione Asia.
//
// NON cambia strategia ne' notifiche: decide SOLO se in questo ciclo cron e'
// permesso chiamare l'AI (OpenAI). Fuori dalla sessione Asia il comportamento
// resta quello di sempre (AI chiamata a ogni ciclo). Dentro la sessione Asia,
// l'AI viene chiamata solo se c'e' un evento di calendario ad alto impatto
// vicino, oppure una breaking news rilevante per XAUUSD appena uscita.
//
// La sessione Asia e' gia' calcolata da computeSessionInfo() in marketData.ts
// (marketSnapshot.session.sessione === "asia") -- qui la riusiamo, non la
// ricalcoliamo.

import type { EconomicEvent } from "@/lib/server/calendar";
import type { NewsItem } from "@/lib/server/news";
import type { StructureResult } from "@/lib/server/ictStructure";
import type { RejectionSignal } from "@/lib/server/rejection";

const NEWS_EVENT_WINDOW_MINUTES = 30;

const BREAKING_NEWS_MAX_AGE_MINUTES = 15;

export interface AiGateResult {
  allowed: boolean;
  reason: string;
}

function hasHighImpactEventNearby(now: Date, calendar: EconomicEvent[]): EconomicEvent | null {
  const windowMs = NEWS_EVENT_WINDOW_MINUTES * 60 * 1000;
  return (
    calendar.find((e) => {
      if (e.impact !== "high") return false;
      const eventTime = new Date(e.time).getTime();
      if (!Number.isFinite(eventTime)) return false;
      return Math.abs(eventTime - now.getTime()) <= windowMs;
    }) ?? null
  );
}

function hasBreakingNews(now: Date, news: NewsItem[]): NewsItem | null {
  const maxAgeMs = BREAKING_NEWS_MAX_AGE_MINUTES * 60 * 1000;
  return (
    news.find((n) => {
      if (!n.time) return false;
      const publishedAt = new Date(n.time).getTime();
      if (!Number.isFinite(publishedAt)) return false;
      const ageMs = now.getTime() - publishedAt;
      return ageMs >= 0 && ageMs <= maxAgeMs;
    }) ?? null
  );
}

export function shouldCallAI(
  isAsiaSession: boolean,
  calendar: EconomicEvent[],
  news: NewsItem[],
  now: Date = new Date()
): AiGateResult {
  // ECCEZIONE ASIA DISATTIVATA (26/08): in 24 ore la sessione Asia non ha
  // prodotto NESSUN trade (l'AI restava silenziata per intere notti senza
  // che scattasse mai un evento/news abbastanza "alto impatto"), mentre il
  // prezzo si muoveva comunque anche di 30-40 punti. L'AI ora viene chiamata
  // sempre, in ogni sessione, come nelle altre fasce orarie. Le funzioni
  // hasHighImpactEventNearby/hasBreakingNews restano definite sotto,
  // inutilizzate, nel caso si voglia reintrodurre una logica simile in futuro.
  void isAsiaSession;
  void calendar;
  void news;
  void now;
  return { allowed: true, reason: "Eccezione Asia disattivata - AI chiamata sempre, 24 ore su 24" };
}

// ---------------------------------------------------------------------------
// FILTRO TECNICO LOCALE (26/08)
//
// Obiettivo: ridurre il consumo di credito OpenAI. Prima l'AI veniva chiamata a
// ogni ciclo cron (ogni 5 minuti) anche quando sul grafico non stava succedendo
// nulla di interessante. Questo filtro gira in locale, a costo zero, e lascia
// passare la chiamata all'AI solo se rileva almeno `sogliaSegnali` elementi
// tecnici rilevanti: BOS/CHoCH (M15 o M5), displacement (impulso >= 1 ATR con
// rigetto su 5m o 15m), oppure la rottura della liquidita' delle ultime 24h.
//
// NON cambia la strategia: quando il filtro blocca, il ciclo viene comunque
// registrato come NO_TRADE con la spiegazione, esattamente come gli altri cicli.
// ---------------------------------------------------------------------------

// Ampiezza minima dell'impulso (in ATR) perche' un rigetto valga come displacement.
const DISPLACEMENT_MIN_ATR = 1;

export interface TechnicalSetupInput {
  // Timeframe di setup nell'impianto H4/H1 -> M15 -> M5. Era H1, che non e' piu'
  // un timeframe di analisi: le candele orarie servono solo a liquidita_24h.
  ictStrutturaM15: StructureResult;
  ictStrutturaM5: StructureResult;
  rigetto5m: RejectionSignal;
  rigetto15m: RejectionSignal;
  rigetto30m: RejectionSignal;
  liquidita24h: { massimo: number; minimo: number } | null;
  // Valorizzato quando il prezzo e' nel cuore di un range di accumulo (vedi
  // rilevaRangeAccumulo). Se attivo, il filtro blocca; il motivo finisce
  // nello storico al posto della spiegazione dell'AI.
  rangeAccumulo?: { attivo: boolean; motivo: string } | null;
  // Zone di ingresso (Order Block e FVG) dei tre livelli H4/H1/M15.
  // Servono al veto "prezzo fuori da ogni zona" piu' sotto.
  ictOrderBlocksH4?: { top: number; bottom: number }[];
  ictFvgH4?: { top: number; bottom: number }[];
  ictOrderBlocksH1?: { top: number; bottom: number }[];
  ictFvgH1?: { top: number; bottom: number }[];
  ictOrderBlocksM15?: { top: number; bottom: number }[];
  ictFvgM15?: { top: number; bottom: number }[];
}

export interface TechnicalSetupResult {
  allowed: boolean;
  count: number;
  segnali: string[];
  reason: string;
}

function isDisplacement(rigetto: RejectionSignal): boolean {
  if (!rigetto?.rilevato) return false;
  const ampiezza = rigetto.ampiezzaImpulsoInAtr;
  return typeof ampiezza === "number" && Number.isFinite(ampiezza) && ampiezza >= DISPLACEMENT_MIN_ATR;
}

export interface EventoAttivoSintesi {
  tipo: string;
  timeframe: string;
  direzione: string;
  livello: number;
}

export function hasTechnicalSetup(
  snapshot: TechnicalSetupInput,
  prezzo: number,
  sogliaSegnali: number,
  eventiAttivi: EventoAttivoSintesi[] = []
): TechnicalSetupResult {
  const segnali: string[] = [];

  // Eventi ancora ACTIVE nella memoria del setup: contano anche se in questo
  // preciso istante non sono piu' visibili sul grafico. E' il motivo per cui
  // questo modulo esiste -- prima uno sweep o un displacement sparivano dopo
  // pochi minuti e l'AI non veniva piu' chiamata sullo stesso setup valido.
  for (const e of eventiAttivi) {
    segnali.push(`${e.tipo.toUpperCase()} ${e.timeframe} ${e.direzione} a ${Number(e.livello).toFixed(2)} (ancora attivo)`);
  }

  const eventoM15 = snapshot.ictStrutturaM15?.evento ?? null;
  if (eventoM15) {
    segnali.push(`${eventoM15} su M15 (${snapshot.ictStrutturaM15.direzioneEvento ?? "direzione n/d"})`);
  }

  const eventoM5 = snapshot.ictStrutturaM5?.evento ?? null;
  if (eventoM5) {
    segnali.push(`${eventoM5} su M5 (${snapshot.ictStrutturaM5.direzioneEvento ?? "direzione n/d"})`);
  }

  if (isDisplacement(snapshot.rigetto5m)) {
    segnali.push(`displacement 5m (impulso ${snapshot.rigetto5m.ampiezzaImpulsoInAtr?.toFixed(2)} ATR)`);
  }

  if (isDisplacement(snapshot.rigetto15m)) {
    segnali.push(`displacement 15m (impulso ${snapshot.rigetto15m.ampiezzaImpulsoInAtr?.toFixed(2)} ATR)`);
  }

  const liq = snapshot.liquidita24h;
  if (liq && Number.isFinite(prezzo)) {
    if (prezzo >= liq.massimo) {
      segnali.push(`rottura del massimo 24h (${liq.massimo})`);
    } else if (prezzo <= liq.minimo) {
      segnali.push(`rottura del minimo 24h (${liq.minimo})`);
    }
  }

  const count = segnali.length;

  // VETO: il prezzo non e' dentro nessuna zona di ingresso.
  //
  // L'entry di un setup ICT e' sempre il bordo di un Order Block o di una FVG,
  // e da questa versione un segnale viene emesso solo se e' gia' eseguibile al
  // prezzo corrente. Se il prezzo non si trova dentro nessuna di quelle zone,
  // un ingresso eseguibile non puo' esistere: chiamare l'AI e' spesa certa.
  //
  // Sui dati reali (3 giorni, 56 trade generati) la differenza e' netta:
  //   prezzo DENTRO una zona -> 21 vincite, 3 perdite, +35.16R
  //   prezzo FUORI da ogni zona -> 6 vincite, 9 perdite, +6.30R
  // Il veto quindi non taglia solo la spesa (circa un ciclo su cinque), taglia
  // anche la categoria di trade che rende peggio.
  //
  // Le zone considerate sono quelle dei tre livelli: M15 e' dove nasce
  // l'entry, H4/H1 sono le zone istituzionali della narrativa.
  const zone = [
    ...(snapshot.ictOrderBlocksH4 ?? []),
    ...(snapshot.ictFvgH4 ?? []),
    ...(snapshot.ictOrderBlocksH1 ?? []),
    ...(snapshot.ictFvgH1 ?? []),
    ...(snapshot.ictOrderBlocksM15 ?? []),
    ...(snapshot.ictFvgM15 ?? []),
  ];
  const dentroUnaZona = zone.some((z) => {
    const top = Number(z?.top);
    const bottom = Number(z?.bottom);
    return Number.isFinite(top) && Number.isFinite(bottom) && prezzo >= bottom && prezzo <= top;
  });

  if (zone.length > 0 && !dentroUnaZona) {
    return {
      allowed: false,
      count,
      segnali,
      reason: `Prezzo ${prezzo.toFixed(2)} fuori da tutte le ${zone.length} zone di ingresso (Order Block e FVG su H4/H1/M15): nessun pullback eseguibile, AI non chiamata.`,
    };
  }

  // Veto: il prezzo e' chiuso da due ore in una fascia M5 stretta rispetto
  // all'ATR -- una zona di accumulo. Vince sul conteggio dei segnali: dentro
  // una fascia cosi' i trade nascono e muoiono contro il bordo opposto. Si
  // spegne appena arriva una rottura strutturale (vedi rilevaRangeAccumulo).
  if (snapshot.rangeAccumulo?.attivo) {
    return {
      allowed: false,
      count,
      segnali,
      reason: `Trade evitato: ${snapshot.rangeAccumulo.motivo}. Setup tecnico rilevato: ${count}/${sogliaSegnali}. AI non chiamata.`,
    };
  }

  const allowed = count >= sogliaSegnali;

  const reason = allowed
    ? `Filtro tecnico superato (${count}/${sogliaSegnali}): ${segnali.join("; ")}`
    : count === 0
      ? `Nessun setup tecnico rilevato (servono ${sogliaSegnali} segnali): nessun BOS/CHoCH, nessun displacement, nessuna rottura di liquidita' 24h. AI non chiamata per non sprecare credito.`
      : `Setup tecnico insufficiente (${count}/${sogliaSegnali}): ${segnali.join("; ")}. AI non chiamata per non sprecare credito.`;

  return { allowed, count, segnali, reason };
}
