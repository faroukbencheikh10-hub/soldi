// ---------------------------------------------------------------------------
// CONTESTO DI MERCATO STRUTTURATO
//
// Vista compatta di "cosa sta facendo il grafico", per timeframe.
//
// Regola di progetto: questo modulo NON possiede dati. Non ricalcola swing o
// zone gia' presenti nello snapshot, non ricopia gli eventi (che vivono in
// setup_events e sono gli unici titolari della loro vita). Assembla, e aggiunge
// solo le due cose che oggi non esistono da nessuna parte: il REGIME e la FASE.
//
// Tutto qui dentro e' derivabile dalle candele e dagli eventi gia' salvati,
// quindi si ricalcola a ogni ciclo invece di essere persistito: una copia
// salvata potrebbe divergere dal grafico, questa no.
// ---------------------------------------------------------------------------

import { computeSwings, computeStructure } from "@/lib/server/ictStructure";
import type { OrderBlock, FVG, LivelliUguali } from "@/lib/server/ictStructure";
import type { Candela, Direzione, Timeframe } from "@/lib/server/setupState";

export type Regime = "trend_rialzista" | "trend_ribassista" | "range" | "indeciso";
export type Fase = "impulso" | "pullback" | "consolidamento" | "possibile_reversal" | "indefinita";

export interface EventoContesto {
  id: string;
  tipo: "sweep" | "displacement" | "bos" | "choch";
  timeframe: Timeframe;
  direzione: Direzione;
  livello: number;
  candelaTs: string;
}

export interface SwingRilevante {
  prezzo: number;
  barreFa: number;
}

export interface MomentumContesto {
  direzione: "rialzo" | "ribasso" | "nessuna";
  candeleConsecutive: number;
  forza: number;
}

export interface ContestoTimeframe {
  timeframe: Timeframe;
  regime: Regime;
  fase: Fase;
  swingHigh: SwingRilevante | null;
  swingLow: SwingRilevante | null;
  eventiAttiviIds: string[];
  eventi: EventoContesto[];
  zone: { orderBlocks: OrderBlock[]; fvg: FVG[]; livelliUguali: LivelliUguali | null };
  momentum: MomentumContesto;
  ampiezzaRecenteInAtr: number | null;
}

export interface ContestoMercato {
  prezzo: number;
  aggiornatoIl: string;
  m30: ContestoTimeframe;
  m15: ContestoTimeframe;
  m5: ContestoTimeframe;
  liquidita24h: { massimo: number; minimo: number; posizionePct: number | null } | null;
  eventiInvalidati: { tipo: string; timeframe: string; direzione: string; motivo: string }[];
}

const CANDELE_RECENTI = 6;
const CANDELE_EVENTO_RECENTE = 4;
const COMPRESSIONE_MAX_ATR = 1.2;

function num(c: Candela) {
  return { o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close), ts: c.datetime };
}

function chiuse(candele: Candela[] | undefined) {
  if (!Array.isArray(candele)) return [];
  return candele.slice(1).map(num).filter((x) => Number.isFinite(x.h) && Number.isFinite(x.l));
}

function ampiezzaInAtr(candele: Candela[] | undefined, atr: number | null): number | null {
  const c = chiuse(candele).slice(0, CANDELE_RECENTI);
  if (c.length < 3 || atr === null || atr <= 0) return null;
  const massimo = Math.max(...c.map((x) => x.h));
  const minimo = Math.min(...c.map((x) => x.l));
  return Number(((massimo - minimo) / atr).toFixed(2));
}

export function calcolaRegime(candele: Candela[] | undefined, atr: number | null): Regime {
  if (!Array.isArray(candele) || candele.length < 5) return "indeciso";
  const bias = computeStructure(candele).bias;
  if (bias === "rialzista") return "trend_rialzista";
  if (bias === "ribassista") return "trend_ribassista";
  const ampiezza = ampiezzaInAtr(candele, atr);
  if (ampiezza !== null && ampiezza <= COMPRESSIONE_MAX_ATR * 2) return "range";
  return "indeciso";
}

function momentumDa(candele: Candela[] | undefined, atr: number | null): MomentumContesto {
  const c = chiuse(candele);
  if (c.length < 3) return { direzione: "nessuna", candeleConsecutive: 0, forza: 0 };

  const suPrima = c[0].c > c[0].o;
  let consecutive = 0;
  for (const cand of c) {
    const su = cand.c > cand.o;
    if (su !== suPrima) break;
    consecutive += 1;
    if (consecutive >= 10) break;
  }
  if (consecutive === 0) return { direzione: "nessuna", candeleConsecutive: 0, forza: 0 };

  const corpoMedio =
    c.slice(0, 3).reduce((s, x) => s + Math.abs(x.c - x.o), 0) / Math.min(3, c.length);
  const quotaCorpo = atr !== null && atr > 0 ? Math.min(1, corpoMedio / atr) : 0;
  const quotaSerie = Math.min(1, consecutive / 5);
  const forza = Math.round(100 * (quotaSerie * 0.5 + quotaCorpo * 0.5));

  return { direzione: suPrima ? "rialzo" : "ribasso", candeleConsecutive: consecutive, forza };
}

function swingRilevanti(candele: Candela[] | undefined) {
  if (!Array.isArray(candele) || candele.length < 5) return { swingHigh: null, swingLow: null };
  const swings = computeSwings(candele);
  const massimi = swings.filter((s) => s.tipo === "massimo");
  const minimi = swings.filter((s) => s.tipo === "minimo");
  const ultimoMax = massimi.length > 0 ? massimi[massimi.length - 1] : null;
  const ultimoMin = minimi.length > 0 ? minimi[minimi.length - 1] : null;
  return {
    swingHigh: ultimoMax ? { prezzo: ultimoMax.prezzo, barreFa: ultimoMax.indiceOriginale } : null,
    swingLow: ultimoMin ? { prezzo: ultimoMin.prezzo, barreFa: ultimoMin.indiceOriginale } : null,
  };
}

// La fase e' l'unica cosa che guarda insieme candele, eventi attivi e regime.
// Ordine di valutazione: prima cio' che nega il regime, poi cio' che lo spinge.
export function calcolaFase(
  candele: Candela[] | undefined,
  eventi: EventoContesto[],
  regime: Regime,
  momentum: MomentumContesto,
  atr: number | null
): Fase {
  const c = chiuse(candele);
  if (c.length < 3) return "indefinita";

  const tsRecenti = c.slice(0, CANDELE_EVENTO_RECENTE).map((x) => new Date(x.ts).getTime());
  const sogliaRecente = tsRecenti.length > 0 ? Math.min(...tsRecenti) : 0;
  const recenti = eventi.filter((e) => new Date(e.candelaTs).getTime() >= sogliaRecente);

  const direzioneRegime: Direzione | null =
    regime === "trend_rialzista" ? "rialzista" : regime === "trend_ribassista" ? "ribassista" : null;

  // Un CHoCH o uno sweep contro il regime e' il segnale piu' forte: viene prima.
  if (direzioneRegime) {
    const contro = eventi.find(
      (e) => (e.tipo === "choch" || e.tipo === "sweep") && e.direzione !== direzioneRegime
    );
    if (contro) return "possibile_reversal";
  }

  const displacement = recenti.find((e) => e.tipo === "displacement");
  if (displacement) {
    const allineato =
      (displacement.direzione === "rialzista" && momentum.direzione === "rialzo") ||
      (displacement.direzione === "ribassista" && momentum.direzione === "ribasso");
    return allineato ? "impulso" : "pullback";
  }

  const displacementAttivo = eventi.find((e) => e.tipo === "displacement");
  if (displacementAttivo) {
    const controImpulso =
      (displacementAttivo.direzione === "rialzista" && momentum.direzione === "ribasso") ||
      (displacementAttivo.direzione === "ribassista" && momentum.direzione === "rialzo");
    if (controImpulso) return "pullback";
  }

  const ampiezza = ampiezzaInAtr(candele, atr);
  if (ampiezza !== null && ampiezza <= COMPRESSIONE_MAX_ATR) return "consolidamento";

  return "indefinita";
}

function contestoTimeframe(
  timeframe: Timeframe,
  candele: Candela[] | undefined,
  atr: number | null,
  eventi: EventoContesto[],
  zone: { orderBlocks: OrderBlock[]; fvg: FVG[]; livelliUguali: LivelliUguali | null }
): ContestoTimeframe {
  const regime = calcolaRegime(candele, atr);
  const momentum = momentumDa(candele, atr);
  const { swingHigh, swingLow } = swingRilevanti(candele);
  const fase = calcolaFase(candele, eventi, regime, momentum, atr);

  return {
    timeframe,
    regime,
    fase,
    swingHigh,
    swingLow,
    eventiAttiviIds: eventi.map((e) => e.id),
    eventi,
    zone,
    momentum,
    ampiezzaRecenteInAtr: ampiezzaInAtr(candele, atr),
  };
}

export interface IngressoContesto {
  prezzo: number;
  candles: Record<string, Candela[] | undefined>;
  atr30m: number | null;
  atr15m: number | null;
  atr5m: number | null;
  liquidita24h: { massimo: number; minimo: number } | null;
  zoneM30: { orderBlocks: OrderBlock[]; fvg: FVG[]; livelliUguali: LivelliUguali | null };
  zoneM15: { orderBlocks: OrderBlock[]; fvg: FVG[]; livelliUguali: LivelliUguali | null };
  zoneM5: { orderBlocks: OrderBlock[]; fvg: FVG[]; livelliUguali: LivelliUguali | null };
}

export function costruisciContesto(
  input: IngressoContesto,
  eventiAttivi: EventoContesto[],
  eventiInvalidati: { tipo: string; timeframe: string; direzione: string; motivo: string }[] = []
): ContestoMercato {
  const per = (tf: Timeframe) => eventiAttivi.filter((e) => e.timeframe === tf);

  const liq = input.liquidita24h;
  const posizionePct =
    liq && liq.massimo > liq.minimo
      ? Number((((input.prezzo - liq.minimo) / (liq.massimo - liq.minimo)) * 100).toFixed(1))
      : null;

  return {
    prezzo: input.prezzo,
    aggiornatoIl: new Date().toISOString(),
    m30: contestoTimeframe("M30", input.candles["30m"], input.atr30m, per("M30"), input.zoneM30),
    m15: contestoTimeframe("M15", input.candles["15m"], input.atr15m, per("M15"), input.zoneM15),
    m5: contestoTimeframe("M5", input.candles["5m"], input.atr5m, per("M5"), input.zoneM5),
    liquidita24h: liq ? { ...liq, posizionePct } : null,
    eventiInvalidati,
  };
}

// ---------------------------------------------------------------------------
// REGISTRO: compressione, firma e transizione
//
// market_context e' un REGISTRO DI AUDIT, non la fonte di verita'. Il contesto
// resta ricalcolato a ogni ciclo dalle candele e da setup_events; qui sotto ci
// sono solo le funzioni che ne producono una versione salvabile (senza candele),
// la firma che decide se vale la pena scrivere una riga, e il confronto con la
// riga precedente.
// ---------------------------------------------------------------------------

const ZONE_PER_TIPO = 3;

function distanzaDaZona(prezzo: number, z: { top: number; bottom: number }): number {
  const alto = Math.max(Number(z.top), Number(z.bottom));
  const basso = Math.min(Number(z.top), Number(z.bottom));
  if (!Number.isFinite(alto) || !Number.isFinite(basso)) return Number.POSITIVE_INFINITY;
  if (prezzo >= basso && prezzo <= alto) return 0;
  return prezzo > alto ? prezzo - alto : basso - prezzo;
}

function zonePiuVicine<T extends { top: number; bottom: number }>(zone: T[] | undefined, prezzo: number): T[] {
  if (!Array.isArray(zone)) return [];
  return [...zone]
    .filter((z) => Number.isFinite(Number(z.top)) && Number.isFinite(Number(z.bottom)))
    .sort((a, b) => distanzaDaZona(prezzo, a) - distanzaDaZona(prezzo, b))
    .slice(0, ZONE_PER_TIPO);
}

export interface TimeframeCompresso {
  regime: Regime;
  fase: Fase;
  swingHigh: SwingRilevante | null;
  swingLow: SwingRilevante | null;
  eventiAttiviIds: string[];
  momentum: MomentumContesto;
  ampiezzaRecenteInAtr: number | null;
  zoneVicine: {
    orderBlocks: OrderBlock[];
    fvg: FVG[];
    livelliUguali: LivelliUguali | null;
  };
}

export interface ContestoCompresso {
  prezzo: number;
  aggiornatoIl: string;
  m30: TimeframeCompresso;
  m15: TimeframeCompresso;
  m5: TimeframeCompresso;
  liquidita24h: { massimo: number; minimo: number; posizionePct: number | null } | null;
  eventiInvalidati: { tipo: string; timeframe: string; direzione: string; motivo: string }[];
}

function comprimiTimeframe(tf: ContestoTimeframe, prezzo: number): TimeframeCompresso {
  return {
    regime: tf.regime,
    fase: tf.fase,
    swingHigh: tf.swingHigh,
    swingLow: tf.swingLow,
    eventiAttiviIds: tf.eventiAttiviIds,
    momentum: tf.momentum,
    ampiezzaRecenteInAtr: tf.ampiezzaRecenteInAtr,
    zoneVicine: {
      orderBlocks: zonePiuVicine(tf.zone.orderBlocks, prezzo),
      fvg: zonePiuVicine(tf.zone.fvg, prezzo),
      livelliUguali: tf.zone.livelliUguali,
    },
  };
}

// Versione salvabile: nessuna candela, solo le zone piu' vicine al prezzo.
export function comprimiContesto(ctx: ContestoMercato): ContestoCompresso {
  return {
    prezzo: ctx.prezzo,
    aggiornatoIl: ctx.aggiornatoIl,
    m30: comprimiTimeframe(ctx.m30, ctx.prezzo),
    m15: comprimiTimeframe(ctx.m15, ctx.prezzo),
    m5: comprimiTimeframe(ctx.m5, ctx.prezzo),
    liquidita24h: ctx.liquidita24h,
    eventiInvalidati: ctx.eventiInvalidati,
  };
}

// La firma decide QUANDO scrivere una riga. Volutamente NON contiene il prezzo:
// il prezzo che oscilla non e' un cambio di contesto. Contiene cio' che cambia
// la lettura del grafico: regime, fase, direzione del momentum, eventi attivi,
// e la volatilita' arrotondata a mezzo ATR.
export function firmaContesto(ctx: ContestoMercato): string {
  const perTf = (tf: ContestoTimeframe) => {
    const amp = tf.ampiezzaRecenteInAtr === null ? "na" : String(Math.round(tf.ampiezzaRecenteInAtr * 2) / 2);
    return `${tf.timeframe}:${tf.regime}:${tf.fase}:${tf.momentum.direzione}:${amp}`;
  };
  const eventi = [...ctx.m30.eventiAttiviIds, ...ctx.m15.eventiAttiviIds, ...ctx.m5.eventiAttiviIds]
    .sort()
    .join(",");
  return `${perTf(ctx.m30)}|${perTf(ctx.m15)}|${perTf(ctx.m5)}#eventi=${eventi}`;
}

export interface Transizione {
  cambiamenti: Record<string, { da: string; a: string }>;
  eventiAggiunti: string[];
  eventiRimossi: string[];
  variazionePrezzo: number | null;
}

export function calcolaTransizione(
  precedente: ContestoCompresso | null,
  corrente: ContestoMercato
): Transizione {
  const cambiamenti: Record<string, { da: string; a: string }> = {};
  if (!precedente) {
    return { cambiamenti, eventiAggiunti: [], eventiRimossi: [], variazionePrezzo: null };
  }

  const coppie: [string, TimeframeCompresso, ContestoTimeframe][] = [
    ["m30", precedente.m30, corrente.m30],
    ["m15", precedente.m15, corrente.m15],
    ["m5", precedente.m5, corrente.m5],
  ];

  for (const [nome, prima, dopo] of coppie) {
    if (prima?.regime !== dopo.regime) cambiamenti[`${nome}.regime`] = { da: String(prima?.regime), a: dopo.regime };
    if (prima?.fase !== dopo.fase) cambiamenti[`${nome}.fase`] = { da: String(prima?.fase), a: dopo.fase };
    if (prima?.momentum?.direzione !== dopo.momentum.direzione) {
      cambiamenti[`${nome}.momentum`] = { da: String(prima?.momentum?.direzione), a: dopo.momentum.direzione };
    }
  }

  const idsPrima = new Set([
    ...(precedente.m30?.eventiAttiviIds ?? []),
    ...(precedente.m15?.eventiAttiviIds ?? []),
    ...(precedente.m5?.eventiAttiviIds ?? []),
  ]);
  const idsDopo = new Set([
    ...corrente.m30.eventiAttiviIds,
    ...corrente.m15.eventiAttiviIds,
    ...corrente.m5.eventiAttiviIds,
  ]);

  return {
    cambiamenti,
    eventiAggiunti: [...idsDopo].filter((id) => !idsPrima.has(id)),
    eventiRimossi: [...idsPrima].filter((id) => !idsDopo.has(id)),
    variazionePrezzo:
      Number.isFinite(precedente.prezzo) && precedente.prezzo !== 0
        ? Number((corrente.prezzo - precedente.prezzo).toFixed(3))
        : null,
  };
}
