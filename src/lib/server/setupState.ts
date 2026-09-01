// ---------------------------------------------------------------------------
// MEMORIA DEGLI EVENTI DI SETUP
//
// Il problema che risolve: i rilevatori esistenti (computeStructure,
// computeRejection, il controllo sulla liquidita') rispondono alla domanda
// "sta succedendo adesso?", non "e' successo di recente?". Un BOS smette di
// esistere appena il prezzo rientra sotto il livello rotto; un displacement e'
// visibile solo nelle due candele successive; e uno sweep -- che per
// definizione e' un'escursione oltre il livello seguita dal rientro -- veniva
// visto solo mentre il prezzo era ancora fuori, cioe' prima che fosse davvero
// uno sweep.
//
// Qui gli eventi vengono RILEVATI SULLE CANDELE CHIUSE e registrati una volta
// sola, con il timestamp della candela che li ha generati. Restano ACTIVE
// finche' non vengono invalidati dal prezzo (chiusura oltre il livello nella
// direzione opposta). Il TTL e' solo un tetto di sicurezza, non il criterio
// normale di scadenza.
//
// Questo modulo contiene SOLO logica pura: nessun accesso al database, cosi'
// e' verificabile con candele sintetiche.
// ---------------------------------------------------------------------------

import { computeStructure } from "@/lib/server/ictStructure";

export type TipoEvento = "sweep" | "displacement" | "bos" | "choch";
// H1 non e' piu' un timeframe di analisi (le candele orarie servono solo a
// calcolare liquidita_24h), ma resta nel tipo perche' in setup_events possono
// esistere righe H1 ancora ACTIVE scritte prima del passaggio a M15: devono
// poter essere lette, invalidate e fatte scadere come le altre.
export type Timeframe = "M5" | "M15" | "M30" | "H1";
export type Direzione = "rialzista" | "ribassista";

export interface Candela {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
}

export interface EventoRilevato {
  tipo: TipoEvento;
  timeframe: Timeframe;
  direzione: Direzione;
  livello: number;
  candelaTs: string;
}

export interface EventoAttivo extends EventoRilevato {
  id: string;
  rilevatoIl: string;
}

// Tetti di sicurezza: un evento non puo' restare vivo oltre questa eta' nemmeno
// se nessuno lo ha invalidato. NON e' il meccanismo normale di chiusura.
export const TTL_MS: Record<Timeframe, number> = {
  H1: 4 * 60 * 60 * 1000,
  M30: 90 * 60 * 1000,
  M15: 45 * 60 * 1000,
  M5: 20 * 60 * 1000,
};

// Durata nominale di una candela, per timeframe. Serve a stabilire se una
// candela e' CHIUSA guardando l'orologio, non la sua posizione nell'array.
export const DURATA_MS: Record<Timeframe, number> = {
  H1: 60 * 60 * 1000,
  M30: 30 * 60 * 1000,
  M15: 15 * 60 * 1000,
  M5: 5 * 60 * 1000,
};

// Nessuna tolleranza: una candela conta come chiusa solo quando la sua durata
// e' trascorsa per intero.
//
// Una versione precedente concedeva 5 secondi di margine per lo scarto fra
// l'orologio del provider e il nostro. E' sbagliato: entrambe le fonti
// restituiscono la candela ANCORA IN FORMAZIONE in testa all'array
// (verificato sugli snapshot reali: alle 03:17 l'indice 0 del 5m era la
// candela delle 03:15), quindi quel margine faceva passare per chiusa una
// candela ancora viva, e un BOS poteva essere rilevato su una struttura che
// il resto della candela avrebbe potuto smentire. Meglio aspettare qualche
// secondo in piu' che registrare un evento inesistente.
const TOLLERANZA_CHIUSURA_MS = 0;

const CANDELE_DA_ISPEZIONARE = 12;
const FINESTRA_LIQUIDITA = 20;
const MIN_IMPULSO_ATR = 0.8;
const MIN_CORPO_SU_RANGE = 0.5;

interface CandelaNum {
  open: number;
  high: number;
  low: number;
  close: number;
  ts: string;
  // Posizione della candela nell'array ORIGINALE ricevuto dal chiamante.
  // computeStructure vuole la serie grezza, e normalizza() puo' aver scartato
  // candele malformate: senza questo indice le due numerazioni divergerebbero
  // e si analizzerebbe una finestra spostata.
  idxOriginale: number;
}

function normalizza(candele: Candela[] | undefined): CandelaNum[] {
  if (!Array.isArray(candele)) return [];
  return candele
    .map((c, idxOriginale) => ({
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      ts: c.datetime,
      idxOriginale,
    }))
    .filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(new Date(c.ts).getTime())
    );
}

/**
 * Indice della prima candela CHIUSA, contando dalla piu' recente.
 *
 * Prima si assumeva che fosse sempre l'indice 1, cioe' che l'indice 0 fosse
 * per definizione la candela in formazione. E' vero per Twelve Data, che
 * restituisce la barra in corso in testa; NON e' garantito per l'endpoint
 * historical-market-data di MetaApi, che e' un archivio di candele gia'
 * chiuse. Con quella fonte lo scarto fisso di uno buttava via la candela
 * chiusa PIU' RECENTE: un timeframe intero di ritardo su ogni evento, che si
 * sommava all'attesa della chiusura successiva.
 *
 * Qui la domanda viene posta all'orologio: una candela e' chiusa quando la sua
 * apertura piu' la durata del timeframe e' gia' passata. Funziona con
 * entrambe le fonti e non si rompe se un provider cambia comportamento.
 */
export function indicePrimaCandelaChiusa(
  candele: Candela[] | undefined,
  timeframe: Timeframe,
  adesso: number = Date.now()
): number {
  const c = normalizza(candele);
  const durata = DURATA_MS[timeframe];
  for (let i = 0; i < c.length; i++) {
    const apertura = new Date(c[i].ts).getTime();
    if (apertura + durata <= adesso + TOLLERANZA_CHIUSURA_MS) return i;
  }
  return c.length;
}

// Le candele arrivano dalla piu' recente alla piu' vecchia. L'analisi parte
// dalla prima candela realmente CHIUSA (vedi indicePrimaCandelaChiusa): quella
// eventualmente ancora in formazione viene saltata, ma nessuna candela chiusa
// viene piu' scartata solo per la sua posizione nell'array.
export function rilevaEventi(
  candele: Candela[] | undefined,
  atr: number | null,
  timeframe: Timeframe,
  adesso: number = Date.now()
): EventoRilevato[] {
  const c = normalizza(candele);
  if (c.length < FINESTRA_LIQUIDITA + 3) return [];

  const eventi: EventoRilevato[] = [];

  const durata = DURATA_MS[timeframe];
  let inizio = c.length;
  for (let i = 0; i < c.length; i++) {
    const apertura = new Date(c[i].ts).getTime();
    if (apertura + durata <= adesso + TOLLERANZA_CHIUSURA_MS) {
      inizio = i;
      break;
    }
  }

  // Ultima posizione che lascia ancora dietro di se' la finestra di liquidita'
  // piu' la candela precedente richiesta dal displacement.
  const ultimoIspezionabile = c.length - FINESTRA_LIQUIDITA - 2;
  const fine = Math.min(inizio + CANDELE_DA_ISPEZIONARE - 1, ultimoIspezionabile);

  for (let i = inizio; i <= fine; i++) {
    const cand = c[i];
    const precedenti = c.slice(i + 1, i + 1 + FINESTRA_LIQUIDITA);
    if (precedenti.length < 5) continue;

    const massimo = Math.max(...precedenti.map((p) => p.high));
    const minimo = Math.min(...precedenti.map((p) => p.low));

    // SWEEP: il prezzo prende la liquidita' oltre l'estremo e rientra.
    if (cand.high > massimo && cand.close < massimo) {
      eventi.push({ tipo: "sweep", timeframe, direzione: "ribassista", livello: massimo, candelaTs: cand.ts });
    }
    if (cand.low < minimo && cand.close > minimo) {
      eventi.push({ tipo: "sweep", timeframe, direzione: "rialzista", livello: minimo, candelaTs: cand.ts });
    }

    // DISPLACEMENT: candela ampia, con corpo vero, che rompe l'estremo della
    // candela precedente. Il livello registrato e' l'estremo opposto: e' li'
    // che l'impulso viene negato.
    if (atr !== null && atr > 0) {
      const range = cand.high - cand.low;
      const corpo = Math.abs(cand.close - cand.open);
      const precedente = c[i + 1];
      if (range > 0 && range / atr >= MIN_IMPULSO_ATR && corpo / range >= MIN_CORPO_SU_RANGE) {
        const direzione: Direzione = cand.close > cand.open ? "rialzista" : "ribassista";
        const rompe =
          direzione === "rialzista" ? cand.close > precedente.high : cand.close < precedente.low;
        if (rompe) {
          eventi.push({
            tipo: "displacement",
            timeframe,
            direzione,
            livello: direzione === "rialzista" ? cand.low : cand.high,
            candelaTs: cand.ts,
          });
        }
      }
    }

    // BOS / CHoCH: si riusa computeStructure applicata alla serie COME ERA a
    // quella candela (lo slice mette la candela i in posizione 0, che e' il
    // "prezzo attuale" per computeStructure). Si taglia sull'indice originale
    // perche' normalizza() puo' aver scartato candele malformate.
    const serie = Array.isArray(candele) ? candele.slice(cand.idxOriginale) : [];
    if (serie.length >= 5) {
      const struttura = computeStructure(serie);
      if (struttura.evento && struttura.direzioneEvento && struttura.livelloRotto !== null) {
        eventi.push({
          tipo: struttura.evento === "BOS" ? "bos" : "choch",
          timeframe,
          direzione: struttura.direzioneEvento,
          livello: struttura.livelloRotto,
          candelaTs: cand.ts,
        });
      }
    }
  }

  return eventi;
}

// Un evento resta valido finche' il prezzo non chiude oltre il suo livello
// nella direzione che lo nega. Nessun criterio temporale qui dentro.
export function motivoInvalidazione(evento: EventoAttivo, candele: Candela[] | undefined): string | null {
  const c = normalizza(candele);
  const nascita = new Date(evento.candelaTs).getTime();
  if (!Number.isFinite(nascita)) return null;

  const successive = c.filter((x) => new Date(x.ts).getTime() > nascita);

  for (const cand of successive) {
    if (evento.direzione === "rialzista" && cand.close < evento.livello) {
      return `chiusura ${cand.close.toFixed(2)} sotto il livello ${evento.livello.toFixed(2)}`;
    }
    if (evento.direzione === "ribassista" && cand.close > evento.livello) {
      return `chiusura ${cand.close.toFixed(2)} sopra il livello ${evento.livello.toFixed(2)}`;
    }
  }

  return null;
}

export function eventoScaduto(evento: EventoAttivo, adesso: number): boolean {
  const nascita = new Date(evento.rilevatoIl).getTime();
  if (!Number.isFinite(nascita)) return false;
  const ttl = TTL_MS[evento.timeframe];
  if (ttl === undefined) return false;
  return adesso - nascita > ttl;
}

export interface Zona {
  top: number;
  bottom: number;
}

export function prezzoDentroUnaZona(prezzo: number, zone: (Zona[] | undefined)[]): boolean {
  if (!Number.isFinite(prezzo)) return false;
  for (const gruppo of zone) {
    if (!Array.isArray(gruppo)) continue;
    for (const z of gruppo) {
      const top = Number(z?.top);
      const bottom = Number(z?.bottom);
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      if (prezzo <= Math.max(top, bottom) && prezzo >= Math.min(top, bottom)) return true;
    }
  }
  return false;
}

export type TipoZona = "orderBlock" | "fvg";

// Zona operativa gia' etichettata con timeframe/tipo/direzione, cosi' come
// arriva dal chiamante (runAnalysis.ts) prima del controllo "il prezzo e'
// dentro?".
export interface ZonaConTipo extends Zona {
  timeframe: Timeframe;
  tipo: TipoZona;
  direzione: Direzione;
}

// Una zona che il prezzo sta occupando ADESSO, con tutto cio' che la
// distingue da un'altra zona: timeframe, tipo, direzione, top e bottom. Serve
// a rispondere non solo "il prezzo e' in una zona?" ma "in QUALE zona".
export interface ZonaOccupata {
  timeframe: Timeframe;
  tipo: TipoZona;
  direzione: Direzione;
  top: number;
  bottom: number;
}

// Individua le zone operative (Order Block / FVG, su M30/M15/M5) in cui il
// prezzo si trova ora. Sostituisce il vecchio controllo booleano
// "prezzoDentroUnaZona" ai fini della fingerprint: un semplice true/false non
// distingue "il prezzo e' entrato in un nuovo Order Block M30 ribassista" da
// "e' rientrato nella stessa FVG M15 di prima" -- due situazioni diverse che
// devono riattivare l'analisi in modo diverso (o non riattivarla affatto se
// e' la stessa zona di gia').
export function zoneOccupateDalPrezzo(prezzo: number, gruppi: (ZonaConTipo[] | undefined)[]): ZonaOccupata[] {
  if (!Number.isFinite(prezzo)) return [];
  const trovate: ZonaOccupata[] = [];
  for (const gruppo of gruppi) {
    if (!Array.isArray(gruppo)) continue;
    for (const z of gruppo) {
      const top = Number(z?.top);
      const bottom = Number(z?.bottom);
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      if (prezzo <= Math.max(top, bottom) && prezzo >= Math.min(top, bottom)) {
        trovate.push({ timeframe: z.timeframe, tipo: z.tipo, direzione: z.direzione, top, bottom });
      }
    }
  }
  return trovate;
}

// L'impronta cambia quando cambia qualcosa che puo' cambiare la decisione:
// un evento che nasce o viene invalidato, l'ingresso in una zona operativa
// NUOVA (identificata per timeframe/tipo/direzione/estremi, non un semplice
// flag), oppure un movimento del prezzo rispetto al livello dell'evento
// superiore a un quarto di ATR. Non cambia per le oscillazioni minime, e non
// cambia se il prezzo resta nella stessa identica zona di prima.
export function calcolaFingerprint(
  eventi: EventoAttivo[],
  prezzo: number,
  atrRiferimento: number | null,
  zoneOccupate: ZonaOccupata[]
): string {
  const passo = atrRiferimento !== null && atrRiferimento > 0 ? atrRiferimento / 4 : null;

  const parti = eventi
    .map((e) => {
      const distanza = passo !== null ? Math.round((prezzo - e.livello) / passo) : 0;
      return `${e.tipo}:${e.timeframe}:${e.direzione}:${e.livello.toFixed(2)}:${distanza}`;
    })
    .sort();

  const zone = zoneOccupate
    .map((z) => `${z.timeframe}:${z.tipo}:${z.direzione}:${z.top.toFixed(2)}:${z.bottom.toFixed(2)}`)
    .sort();

  return `${parti.join("|")}#zone=${zone.join(",")}`;
}
