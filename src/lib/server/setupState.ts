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
export type Timeframe = "M5" | "M30" | "H1";
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
  M30: 4 * 60 * 60 * 1000,
  M5: 20 * 60 * 1000,
};

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
}

function normalizza(candele: Candela[] | undefined): CandelaNum[] {
  if (!Array.isArray(candele)) return [];
  return candele
    .map((c) => ({
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      ts: c.datetime,
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

// Le candele arrivano dalla piu' recente alla piu' vecchia. L'indice 0 e' la
// candela ancora in formazione: viene ignorata, si guardano solo le chiuse.
export function rilevaEventi(
  candele: Candela[] | undefined,
  atr: number | null,
  timeframe: Timeframe
): EventoRilevato[] {
  const c = normalizza(candele);
  if (c.length < FINESTRA_LIQUIDITA + 3) return [];

  const eventi: EventoRilevato[] = [];
  const limite = Math.min(CANDELE_DA_ISPEZIONARE, c.length - FINESTRA_LIQUIDITA - 2);

  for (let i = 1; i <= limite; i++) {
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
    // quella candela (slice(i) mette la candela i in posizione 0, che e' il
    // "prezzo attuale" per computeStructure).
    const serie = Array.isArray(candele) ? candele.slice(i) : [];
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
  // L'indice 0 e' la candela ancora in formazione. Non puo' invalidare un
  // setup: l'invalidazione richiede una chiusura confermata oltre il livello.
  const c = normalizza(candele).slice(1);
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
  return adesso - nascita > TTL_MS[evento.timeframe];
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

// L'impronta cambia quando cambia qualcosa che puo' cambiare la decisione:
// un evento che nasce o viene invalidato, l'ingresso in una zona operativa,
// oppure un movimento del prezzo rispetto al livello dell'evento superiore a
// un quarto di ATR. Non cambia per le oscillazioni minime.
export function calcolaFingerprint(
  eventi: EventoAttivo[],
  prezzo: number,
  atrRiferimento: number | null,
  zonaRaggiunta: boolean
): string {
  const passo = atrRiferimento !== null && atrRiferimento > 0 ? atrRiferimento / 4 : null;

  const parti = eventi
    .map((e) => {
      const distanza = passo !== null ? Math.round((prezzo - e.livello) / passo) : 0;
      return `${e.tipo}:${e.timeframe}:${e.direzione}:${e.livello.toFixed(2)}:${distanza}`;
    })
    .sort();

  return `${parti.join("|")}#zona=${zonaRaggiunta ? 1 : 0}`;
}
