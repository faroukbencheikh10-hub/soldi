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

export const OTE_INIZIO = 0.62;
export const OTE_IDEALE = 0.705;
export const OTE_FINE = 0.79;

export interface Ote {
  direzione: "rialzista" | "ribassista";
  impulsoDa: number;
  impulsoA: number;
  inizio: number;
  ideale: number;
  fine: number;
  prezzoDentro: boolean;
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

export interface LivelliApertura {
  aperturaGiornaliera: number | null;
  aperturaSettimanale: number | null;
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
  const conData = candeleGiornaliere
    .map((c) => ({ c, t: new Date(c.datetime).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);
  if (conData.length === 0) return vuoto;
  const oggi = conData[0].c;
  const aperturaGiornaliera = Number.isFinite(n(oggi?.open)) ? Number(n(oggi.open).toFixed(2)) : null;
  let aperturaSettimanale: number | null = null;
  {
    const piuRecente = new Date(conData[0].t);
    const giorno = piuRecente.getUTCDay();
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
    return { attuale: "asia", descrizione: "Sessione asiatica (00:00-05:00 UTC)" };
  }
  return { attuale: "nessuna", descrizione: "Fuori dalle kill zone canoniche" };
}

export interface JudasSwing {
  rilevato: boolean;
  direzioneFalsa: "rialzista" | "ribassista" | null;
  livelloViolato: number | null;
  descrizione: string;
  sessione: "londra" | "new-york" | null;
}

function schemaJudas(
  apertura: { h: number; l: number; c: number }[],
  dopo: { h: number; l: number; c: number }[],
  sessione: "londra" | "new-york"
): JudasSwing | null {
  if (apertura.length === 0 || dopo.length === 0) return null;
  const altoApertura = Math.max(...apertura.map((x) => x.h));
  const bassoApertura = Math.min(...apertura.map((x) => x.l));
  const ultimaChiusura = dopo[dopo.length - 1].c;
  const haRottoSopra = dopo.some((x) => x.h > altoApertura);
  const haRottoSotto = dopo.some((x) => x.l < bassoApertura);
  if (haRottoSopra && !haRottoSotto && ultimaChiusura < altoApertura) {
    return {
      rilevato: true,
      direzioneFalsa: "rialzista",
      livelloViolato: Number(altoApertura.toFixed(2)),
      sessione,
      descrizione: `Judas Swing ${sessione}: falsa rottura sopra ${altoApertura.toFixed(2)} all'apertura sessione, poi rientro. Liquidita' sopra presa; direzione vera probabilmente ribassista`,
    };
  }
  if (haRottoSotto && !haRottoSopra && ultimaChiusura > bassoApertura) {
    return {
      rilevato: true,
      direzioneFalsa: "ribassista",
      livelloViolato: Number(bassoApertura.toFixed(2)),
      sessione,
      descrizione: `Judas Swing ${sessione}: falsa rottura sotto ${bassoApertura.toFixed(2)} all'apertura sessione, poi rientro. Liquidita' sotto presa; direzione vera probabilmente rialzista`,
    };
  }
  return null;
}

export function rilevaJudasSwing(
  candele: RawCandle[] | undefined | null,
  _candeleSessione = 6
): JudasSwing {
  const assente: JudasSwing = {
    rilevato: false,
    direzioneFalsa: null,
    livelloViolato: null,
    sessione: null,
    descrizione: "nessun Judas Swing sull'apertura di Londra o New York",
  };
  void _candeleSessione;
  const raw = (candele ?? [])
    .slice(1)
    .map((x) => ({
      h: n(x.high),
      l: n(x.low),
      o: n(x.open),
      c: n(x.close),
      t: new Date(x.datetime).getTime(),
    }))
    .filter((x) => [x.h, x.l, x.o, x.c, x.t].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
  if (raw.length < 4) return assente;
  const adesso = new Date();
  const y = adesso.getUTCFullYear();
  const m = adesso.getUTCMonth();
  const d = adesso.getUTCDate();
  const sessioni: { nome: "londra" | "new-york"; openHour: number; endHour: number }[] = [
    { nome: "londra", openHour: 7, endHour: 10 },
    { nome: "new-york", openHour: 12, endHour: 15 },
  ];
  for (const s of sessioni) {
    const openMs = Date.UTC(y, m, d, s.openHour, 0, 0);
    const rangeEndMs = openMs + 30 * 60 * 1000;
    const sessionEndMs = Date.UTC(y, m, d, s.endHour, 0, 0);
    if (adesso.getTime() < openMs) continue;
    const apertura = raw.filter((x) => x.t >= openMs && x.t < rangeEndMs);
    const dopo = raw.filter((x) => x.t >= rangeEndMs && x.t < sessionEndMs);
    const trovato = schemaJudas(apertura, dopo, s.nome);
    if (trovato) return trovato;
  }
  return assente;
}

export function oteDaSwing(
  swings: { tipo: "massimo" | "minimo"; prezzo: number; indiceOriginale: number }[],
  prezzo: number
): Ote | null {
  if (!Array.isArray(swings) || swings.length < 2) return null;
  const estremo = swings[swings.length - 1];
  let partenza: (typeof swings)[number] | undefined;
  for (let i = swings.length - 2; i >= 0; i--) {
    if (swings[i].tipo !== estremo.tipo) {
      partenza = swings[i];
      break;
    }
  }
  if (!partenza) return null;
  const direzione = estremo.tipo === "massimo" ? "rialzista" : "ribassista";
  return calcolaOte(direzione, partenza.prezzo, estremo.prezzo, prezzo);
}
