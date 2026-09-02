// ---------------------------------------------------------------------------
// CONCETTI ICT ORIGINALI mancanti dal motore
//
// Il percorso a quattro elementi (sweep -> CHoCH/BOS -> displacement ->
// pullback) era gia' implementato, cosi' come i tre livelli H4/H1 -> M15 -> M5.
// Qui stanno i pezzi del metodo di Michael Huddleston che ancora non venivano
// calcolati: OTE, livelli di apertura, kill zone e Judas Swing.
//
// Tutti si ricavano da candele gia' scaricate: nessuna chiamata API in piu'.
//
// NOTA IMPORTANTE SULLE KILL ZONE
// Nel metodo originale si opera quasi solo dentro le kill zone. Sui dati reali
// di questo progetto pero' il risultato e' rovesciato: FUORI dalle kill zone
// 50 trade, 76% di successo, +43.66R; DENTRO 24 trade, 56-57%, +11.21R. Per
// questo la kill zone qui viene CALCOLATA e passata all'AI come contesto, ma
// non blocca nulla: chi legge decide quanto pesarla. Trasformarla in un veto
// taglierebbe, sui numeri attuali, gran parte del rendimento.
// ---------------------------------------------------------------------------

export interface RawCandle {
  datetime: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
}

function n(v: unknown): number {
  return Number(v);
}

// ---------------------------------------------------------------------------
// OTE — OPTIMAL TRADE ENTRY
//
// Dopo un displacement, ICT non entra "da qualche parte dentro la zona": entra
// nel ritracciamento fra il 62% e il 79% del movimento impulsivo, con il 70.5%
// come punto ideale (e' il livello che Huddleston chiama "sweet spot").
//
// Misura il movimento fra lo swing di partenza e quello di arrivo, poi
// riporta la fascia in prezzo. Serve a rispondere alla domanda che il motore
// finora non si poneva: dentro la zona di pullback, DOVE esattamente.
// ---------------------------------------------------------------------------

export const OTE_INIZIO = 0.62;
export const OTE_IDEALE = 0.705;
export const OTE_FINE = 0.79;

export interface Ote {
  direzione: "rialzista" | "ribassista";
  /** Punto di partenza dell'impulso. */
  impulsoDa: number;
  /** Estremo raggiunto dall'impulso: il massimo se rialzista, il minimo se ribassista. */
  impulsoA: number;
  /** Fascia di ingresso ottimale, in prezzo. */
  inizio: number;
  ideale: number;
  fine: number;
  /** true se il prezzo attuale e' dentro la fascia 62-79%. */
  prezzoDentro: boolean;
  /** Quanto e' ritracciato il prezzo, in percentuale dell'impulso. */
  ritracciamentoPct: number | null;
}

export function calcolaOte(
  direzione: "rialzista" | "ribassista",
  impulsoDa: number,
  impulsoA: number,
  prezzo: number
): Ote | null {
  if (![impulsoDa, impulsoA, prezzo].every(Number.isFinite)) return null;
  const ampiezza = Math.abs(impulsoA - impulsoDa);
  if (!(ampiezza > 0)) return null;

  // Il ritracciamento si misura sempre a partire dall'estremo raggiunto
  // dall'impulso e torna verso il punto di partenza.
  const verso = direzione === "rialzista" ? -1 : 1;
  const daEstremo = (frazione: number) => impulsoA + verso * ampiezza * frazione;

  const inizio = daEstremo(OTE_INIZIO);
  const ideale = daEstremo(OTE_IDEALE);
  const fine = daEstremo(OTE_FINE);

  const basso = Math.min(inizio, fine);
  const alto = Math.max(inizio, fine);

  const ritracciato = Math.abs(impulsoA - prezzo) / ampiezza;

  return {
    direzione,
    impulsoDa,
    impulsoA,
    inizio: Number(inizio.toFixed(2)),
    ideale: Number(ideale.toFixed(2)),
    fine: Number(fine.toFixed(2)),
    prezzoDentro: prezzo >= basso && prezzo <= alto,
    ritracciamentoPct: Number((ritracciato * 100).toFixed(1)),
  };
}

// ---------------------------------------------------------------------------
// LIVELLI DI APERTURA
//
// In ICT premium e discount non sono nozioni vaghe: si misurano rispetto ai
// prezzi di apertura. Sopra l'apertura il prezzo e' in premium (si vende),
// sotto e' in discount (si compra). L'apertura giornaliera e' il riferimento
// intraday, quella settimanale inquadra la settimana.
// ---------------------------------------------------------------------------

export interface LivelliApertura {
  aperturaGiornaliera: number | null;
  aperturaSettimanale: number | null;
  /** Posizione del prezzo rispetto all'apertura del giorno. */
  statoGiornaliero: "premium" | "discount" | "sull-apertura" | null;
  statoSettimanale: "premium" | "discount" | "sull-apertura" | null;
  distanzaDaAperturaGiornaliera: number | null;
}

function stato(prezzo: number, apertura: number | null): LivelliApertura["statoGiornaliero"] {
  if (apertura === null || !Number.isFinite(apertura)) return null;
  const scarto = prezzo - apertura;
  if (Math.abs(scarto) < 0.01) return "sull-apertura";
  return scarto > 0 ? "premium" : "discount";
}

export function calcolaLivelliApertura(
  candeleGiornaliere: RawCandle[] | undefined | null,
  prezzo: number
): LivelliApertura {
  const vuoto: LivelliApertura = {
    aperturaGiornaliera: null,
    aperturaSettimanale: null,
    statoGiornaliero: null,
    statoSettimanale: null,
    distanzaDaAperturaGiornaliera: null,
  };
  if (!Array.isArray(candeleGiornaliere) || candeleGiornaliere.length === 0) return vuoto;
  if (!Number.isFinite(prezzo)) return vuoto;

  // Candele ordinate per data, dalla piu' recente. NON ci si affida
  // all'indice 0 dell'array in ingresso: altrove nel motore vale la
  // convenzione "indice 0 = piu' recente", ma se una fonte la invertisse
  // l'apertura del giorno risulterebbe vecchia di giorni senza dare errore.
  // Ordinare qui costa nulla ed elimina il rischio.
  const conData = candeleGiornaliere
    .map((c) => ({ c, t: new Date(c.datetime).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);

  if (conData.length === 0) return vuoto;

  const oggi = conData[0].c;
  const aperturaGiornaliera = Number.isFinite(n(oggi?.open)) ? Number(n(oggi.open).toFixed(2)) : null;

  // Apertura settimanale: la prima candela giornaliera della settimana
  // corrente. Le settimane di mercato aprono la domenica sera, ma sui dati
  // giornalieri il primo giorno utile e' di solito il lunedi'.
  let aperturaSettimanale: number | null = null;

  {
    const piuRecente = new Date(conData[0].t);
    // Giorno della settimana in UTC: 0 = domenica.
    const giorno = piuRecente.getUTCDay();
    // Quanti giorni indietro per arrivare al lunedi' (domenica conta come
    // inizio della settimana di mercato successiva).
    const indietro = giorno === 0 ? 0 : giorno - 1;
    const inizioSettimana = new Date(piuRecente);
    inizioSettimana.setUTCDate(piuRecente.getUTCDate() - indietro);
    inizioSettimana.setUTCHours(0, 0, 0, 0);

    const primaDellaSettimana = [...conData]
      .filter((x) => x.t >= inizioSettimana.getTime())
      .sort((a, b) => a.t - b.t)[0];

    const ap = primaDellaSettimana ? n(primaDellaSettimana.c.open) : NaN;
    aperturaSettimanale = Number.isFinite(ap) ? Number(ap.toFixed(2)) : null;
  }

  return {
    aperturaGiornaliera,
    aperturaSettimanale,
    statoGiornaliero: stato(prezzo, aperturaGiornaliera),
    statoSettimanale: stato(prezzo, aperturaSettimanale),
    distanzaDaAperturaGiornaliera:
      aperturaGiornaliera !== null ? Number((prezzo - aperturaGiornaliera).toFixed(2)) : null,
  };
}

// ---------------------------------------------------------------------------
// KILL ZONE
//
// Le finestre in cui il metodo originale concentra l'operativita'. Calcolate
// in UTC. Restituite come contesto, non come veto -- vedi la nota in testa al
// file: sui dati di questo progetto le kill zone rendono MENO del resto della
// giornata, quindi bloccare fuori da esse sarebbe dannoso.
// ---------------------------------------------------------------------------

export type KillZone = "londra" | "new-york" | "asia" | "nessuna";

export interface ContestoKillZone {
  attuale: KillZone;
  descrizione: string;
}

export function killZoneCorrente(adesso: Date = new Date()): ContestoKillZone {
  const ora = adesso.getUTCHours();
  if (ora >= 7 && ora < 10) {
    return { attuale: "londra", descrizione: "Kill zone di Londra (07:00-10:00 UTC)" };
  }
  if (ora >= 12 && ora < 15) {
    return { attuale: "new-york", descrizione: "Kill zone di New York (12:00-15:00 UTC)" };
  }
  if (ora >= 0 && ora < 5) {
    return { attuale: "asia", descrizione: "Sessione asiatica (00:00-05:00 UTC), storicamente la fascia meno redditizia su questo sistema" };
  }
  return { attuale: "nessuna", descrizione: "Fuori dalle kill zone canoniche" };
}

// ---------------------------------------------------------------------------
// JUDAS SWING (falsa rottura recente)
//
// Nel metodo originale il Judas Swing e' il falso movimento con cui la
// SESSIONE parte nella direzione sbagliata: prende la liquidita' di chi e'
// entrato troppo presto, poi inverte.
//
// PRECISAZIONE ONESTA su cosa fa questa implementazione: non e' ancorata
// all'apertura di Londra o New York. Guarda una finestra mobile delle ultime
// candeleSessione candele (di default 6 su M15, cioe' un'ora e mezza) e
// rileva lo schema "rottura di un estremo del range seguita da rientro".
// E' lo stesso schema del Judas, ma puo' comparire in qualunque momento,
// non solo a inizio sessione. Va letto quindi come "falsa rottura recente":
// utile allo stesso modo, ma senza l'ancoraggio orario dell'originale.
// ---------------------------------------------------------------------------

export interface JudasSwing {
  rilevato: boolean;
  direzioneFalsa: "rialzista" | "ribassista" | null;
  livelloViolato: number | null;
  descrizione: string;
}

export function rilevaJudasSwing(
  candele: RawCandle[] | undefined | null,
  candeleSessione = 6
): JudasSwing {
  const assente: JudasSwing = {
    rilevato: false,
    direzioneFalsa: null,
    livelloViolato: null,
    descrizione: "nessun Judas Swing rilevato",
  };

  // Indice 0 = candela in formazione, esclusa come ovunque nel motore.
  const c = (candele ?? [])
    .slice(1, 1 + candeleSessione)
    .map((x) => ({ h: n(x.high), l: n(x.low), o: n(x.open), c: n(x.close) }))
    .filter((x) => [x.h, x.l, x.o, x.c].every(Number.isFinite));

  if (c.length < 4) return assente;

  // c[0] e' la piu' recente. Il "range di apertura" sono le candele piu'
  // vecchie del gruppo, il movimento successivo quelle piu' recenti.
  const apertura = c.slice(-2);
  const dopo = c.slice(0, -2);
  if (apertura.length === 0 || dopo.length === 0) return assente;

  const altoApertura = Math.max(...apertura.map((x) => x.h));
  const bassoApertura = Math.min(...apertura.map((x) => x.l));
  const ultimaChiusura = dopo[0].c;

  const haRottoSopra = dopo.some((x) => x.h > altoApertura);
  const haRottoSotto = dopo.some((x) => x.l < bassoApertura);

  // Judas rialzista falso: e' uscito sopra, ma ha chiuso sotto il livello.
  if (haRottoSopra && !haRottoSotto && ultimaChiusura < altoApertura) {
    return {
      rilevato: true,
      direzioneFalsa: "rialzista",
      livelloViolato: Number(altoApertura.toFixed(2)),
      descrizione: `Judas Swing: falsa rottura sopra ${altoApertura.toFixed(2)} poi rientro. La liquidita' sopra e' stata presa, il movimento vero e' probabilmente ribassista`,
    };
  }

  // Judas ribassista falso: e' uscito sotto, ma ha chiuso sopra il livello.
  if (haRottoSotto && !haRottoSopra && ultimaChiusura > bassoApertura) {
    return {
      rilevato: true,
      direzioneFalsa: "ribassista",
      livelloViolato: Number(bassoApertura.toFixed(2)),
      descrizione: `Judas Swing: falsa rottura sotto ${bassoApertura.toFixed(2)} poi rientro. La liquidita' sotto e' stata presa, il movimento vero e' probabilmente rialzista`,
    };
  }

  return assente;
}

// ---------------------------------------------------------------------------
// OTE dall'ultimo impulso di un timeframe
//
// Scorciatoia usata dal motore: prende gli ultimi due swing opposti (un
// massimo e un minimo) e li tratta come inizio e fine dell'impulso, poi
// calcola la fascia OTE su quello. Il piu' recente dei due e' l'estremo
// raggiunto, quindi da' anche la direzione del movimento.
// ---------------------------------------------------------------------------

export function oteDaSwing(
  swings: { tipo: "massimo" | "minimo"; prezzo: number; indiceOriginale: number }[],
  prezzo: number
): Ote | null {
  if (!Array.isArray(swings) || swings.length < 2) return null;

  // ATTENZIONE all'ordinamento: computeSwings restituisce gli swing dal PIU'
  // VECCHIO al piu' recente. "indiceOriginale" e' l'indice nell'array delle
  // candele, dove 0 = candela piu' recente, e l'ordinamento e' decrescente su
  // quell'indice -- quindi l'ultimo elemento e' lo swing piu' recente, non il
  // primo. (Lo conferma computeStructure, che usa highs[highs.length - 1] per
  // prendere l'ultimo massimo.) Leggere swings[0] darebbe l'impulso piu'
  // VECCHIO della serie, cioe' una fascia OTE calcolata su un movimento di
  // ore prima.
  const estremo = swings[swings.length - 1];

  // Partendo dall'estremo e risalendo indietro, il primo swing di tipo opposto
  // e' il punto da cui l'impulso e' partito.
  let partenza: (typeof swings)[number] | undefined;
  for (let i = swings.length - 2; i >= 0; i--) {
    if (swings[i].tipo !== estremo.tipo) {
      partenza = swings[i];
      break;
    }
  }
  if (!partenza) return null;

  // Se l'ultimo swing e' un massimo, l'impulso e' salito fino a li'.
  const direzione = estremo.tipo === "massimo" ? "rialzista" : "ribassista";
  return calcolaOte(direzione, partenza.prezzo, estremo.prezzo, prezzo);
}
