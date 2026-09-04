// Session ORB su XAUUSD. Niente ICT, niente AI, niente bias H4.
// Asia: fade dei bordi del range. Londra/NY: breakout sulla chiusura M5.

export type DirezioneTrade = "BUY" | "SELL";
export type SetupNome = "fade" | "orb";

export interface SetupTrend {
  ok: boolean;
  direzione: DirezioneTrade | null;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  rischioRendimento: number;
  zona: string | null;
  motivo: string;
  setup: SetupNome | null;
}

type Candle = {
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  datetime?: string;
};

type Bar = { o: number; h: number; l: number; c: number; t: Date };

const BOX_MAX_ASIA = 15;
const BOX_MAX_ORB = 15;
const BOX_MAX_COMPRESSION = 12;
const NO_CHASE = 8;
const SHOCK_M5 = 20;
const FADE_STOP = 3.5;
const FADE_TP1 = 6;
const FADE_TP2 = 8;
const ORB_TP1_MIN = 12;
const ORB_TP2_MIN = 20;
const ORB_TP2_MAX = 30;
const MIN_RR = 1.5;

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function no(motivo: string): SetupTrend {
  return {
    ok: false,
    direzione: null,
    entry: null,
    stopLoss: null,
    tp1: null,
    tp2: null,
    rischioRendimento: 0,
    zona: null,
    motivo,
    setup: null,
  };
}

function chiuseCronologiche(candele: Candle[] | undefined): Bar[] {
  if (!Array.isArray(candele) || candele.length < 3) return [];
  const out: Bar[] = [];
  for (let i = 1; i < candele.length; i++) {
    const row = candele[i];
    const o = n(row.open);
    const h = n(row.high);
    const l = n(row.low);
    const c = n(row.close);
    const t = row.datetime ? new Date(row.datetime) : null;
    if (![o, h, l, c].every(Number.isFinite) || !t || Number.isNaN(t.getTime())) continue;
    out.push({ o, h, l, c, t });
  }
  out.sort((a, b) => a.t.getTime() - b.t.getTime());
  return out;
}

type SessioneOrb = "asia" | "londra" | "new_york" | "chiuso";

function sessioneUtc(adesso: Date): SessioneOrb {
  const h = adesso.getUTCHours();
  if (h >= 21 || h < 7) return "asia";
  if (h >= 7 && h < 12) return "londra";
  if (h >= 12 && h < 17) return "new_york";
  return "chiuso";
}

function inFinestra(b: Bar, daH: number, aH: number): boolean {
  const h = b.t.getUTCHours();
  if (daH <= aH) return h >= daH && h < aH;
  return h >= daH || h < aH;
}

function boxDa(bars: Bar[]): { high: number; low: number; size: number; n: number } | null {
  if (bars.length < 6) return null;
  const high = Math.max(...bars.map((b) => b.h));
  const low = Math.min(...bars.map((b) => b.l));
  const size = Number((high - low).toFixed(2));
  if (!Number.isFinite(size) || size <= 0) return null;
  return { high: Number(high.toFixed(2)), low: Number(low.toFixed(2)), size, n: bars.length };
}

function falseUscite(bars: Bar[], box: { high: number; low: number }): number {
  let nFalse = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const outPrev = prev.c > box.high || prev.c < box.low;
    const inCur = cur.c <= box.high && cur.c >= box.low;
    if (outPrev && inCur) nFalse += 1;
  }
  return nFalse;
}

function livelli(
  direzione: DirezioneTrade,
  entry: number,
  stopLoss: number,
  tp1Dist: number,
  tp2Dist: number
): { stopLoss: number; tp1: number; tp2: number; rr: number } | null {
  const sl = Number(stopLoss.toFixed(2));
  const en = Number(entry.toFixed(2));
  const rischio = Math.abs(en - sl);
  if (rischio < 1.5) return null;
  const tp1 =
    direzione === "BUY" ? Number((en + tp1Dist).toFixed(2)) : Number((en - tp1Dist).toFixed(2));
  const tp2 =
    direzione === "BUY" ? Number((en + tp2Dist).toFixed(2)) : Number((en - tp2Dist).toFixed(2));
  const rr = Number((Math.abs(tp1 - en) / rischio).toFixed(2));
  if (rr < MIN_RR) return null;
  if (direzione === "BUY" && !(sl < en && en < tp1)) return null;
  if (direzione === "SELL" && !(tp1 < en && en < sl)) return null;
  return { stopLoss: sl, tp1, tp2, rr };
}

function orbTargets(rischio: number): { tp1: number; tp2: number } {
  const tp1 = Math.max(ORB_TP1_MIN, Number((rischio * 1.6).toFixed(2)));
  const tp2 = Math.min(ORB_TP2_MAX, Math.max(ORB_TP2_MIN, Number((rischio * 2.4).toFixed(2))));
  return { tp1, tp2 };
}

function fadeAsia(prezzo: number, m5: Bar[], box: { high: number; low: number; size: number }): SetupTrend {
  if (box.size > BOX_MAX_ASIA) {
    return no(`Asia: range ${box.size.toFixed(2)}$ troppo largo (max ${BOX_MAX_ASIA}$). Fade spento.`);
  }
  const recenti = m5.slice(-16);
  if (falseUscite(recenti, box) >= 2) {
    return no(`Asia: ${falseUscite(recenti, box)} false uscite sul box ${box.low}-${box.high}. Niente fade.`);
  }
  const last = m5[m5.length - 1];
  const vicinoLow = prezzo - box.low <= 2.2;
  const vicinoHigh = box.high - prezzo <= 2.2;
  const confermaBuy = last.c > last.o && last.c >= last.l + (last.h - last.l) * 0.45;
  const confermaSell = last.c < last.o && last.c <= last.h - (last.h - last.l) * 0.45;

  if (vicinoLow && confermaBuy) {
    const entry = Number(prezzo.toFixed(2));
    const lv = livelli("BUY", entry, box.low - FADE_STOP, FADE_TP1, FADE_TP2);
    if (!lv) return no("Asia fade BUY: R:R sotto 1.5 dopo lo stop sul bordo.");
    return {
      ok: true,
      direzione: "BUY",
      entry,
      stopLoss: lv.stopLoss,
      tp1: lv.tp1,
      tp2: lv.tp2,
      rischioRendimento: lv.rr,
      zona: `Asia fade ${box.low}-${box.high}`,
      motivo: `Session ORB · Asia Range Fade BUY sul bordo ${box.low}. Box ${box.size.toFixed(2)}$. TP ${FADE_TP1}/${FADE_TP2}$. Nessun ICT.`,
      setup: "fade",
    };
  }
  if (vicinoHigh && confermaSell) {
    const entry = Number(prezzo.toFixed(2));
    const lv = livelli("SELL", entry, box.high + FADE_STOP, FADE_TP1, FADE_TP2);
    if (!lv) return no("Asia fade SELL: R:R sotto 1.5 dopo lo stop sul bordo.");
    return {
      ok: true,
      direzione: "SELL",
      entry,
      stopLoss: lv.stopLoss,
      tp1: lv.tp1,
      tp2: lv.tp2,
      rischioRendimento: lv.rr,
      zona: `Asia fade ${box.low}-${box.high}`,
      motivo: `Session ORB · Asia Range Fade SELL sul bordo ${box.high}. Box ${box.size.toFixed(2)}$. TP ${FADE_TP1}/${FADE_TP2}$. Nessun ICT.`,
      setup: "fade",
    };
  }
  return no(`Asia: prezzo ${prezzo.toFixed(2)} nel box ${box.low}-${box.high}, non ai bordi o senza conferma M5.`);
}

function breakout(
  prezzo: number,
  last: Bar,
  box: { high: number; low: number; size: number },
  etichetta: string
): SetupTrend {
  if (last.h - last.l >= SHOCK_M5) {
    return no(`Candela M5 da ${(last.h - last.l).toFixed(1)}$: shock, non si insegue.`);
  }
  const closeBuy = last.c > box.high;
  const closeSell = last.c < box.low;
  if (!closeBuy && !closeSell) {
    return no(`${etichetta}: nessuna chiusura M5 fuori dal box ${box.low}-${box.high}.`);
  }
  const direzione: DirezioneTrade = closeBuy ? "BUY" : "SELL";
  const bordo = direzione === "BUY" ? box.high : box.low;
  const oltre = Math.abs(last.c - bordo);
  if (oltre > NO_CHASE) {
    return no(`${etichetta}: chiusura già ${oltre.toFixed(1)}$ oltre il bordo. Niente inseguimento.`);
  }
  const entry = Number(prezzo.toFixed(2));
  const stopLoss = direzione === "BUY" ? box.low - 0.4 : box.high + 0.4;
  const rischio = Math.abs(entry - stopLoss);
  const tgt = orbTargets(rischio);
  const lv = livelli(direzione, entry, stopLoss, tgt.tp1, tgt.tp2);
  if (!lv) return no(`${etichetta}: breakout ${direzione} ma R:R sotto 1.5 (box ${box.size.toFixed(2)}$).`);
  return {
    ok: true,
    direzione,
    entry,
    stopLoss: lv.stopLoss,
    tp1: lv.tp1,
    tp2: lv.tp2,
    rischioRendimento: lv.rr,
    zona: `${etichetta} ${box.low}-${box.high}`,
    motivo: `Session ORB · ${etichetta} ${direzione}. Chiusura M5 fuori dal box ${box.low}-${box.high} (${box.size.toFixed(2)}$). Stop lato opposto, TP1 ${lv.tp1} TP2 ${lv.tp2}. Nessun ICT.`,
    setup: "orb",
  };
}

export function valutaSetupTrend(input: {
  prezzo: number;
  atr15m: number | null;
  atr1h?: number | null;
  session?: { sessione?: string | null } | null;
  candles?: { "5m"?: Candle[]; "15m"?: Candle[]; "1h"?: Candle[]; "4h"?: Candle[] } | null;
}): SetupTrend {
  const prezzo = n(input.prezzo);
  if (!Number.isFinite(prezzo) || prezzo <= 0) return no("Prezzo XAUUSD non disponibile.");

  const m5 = chiuseCronologiche(input.candles?.["5m"]);
  if (m5.length < 12) return no("Candele M5 insufficienti per Session ORB.");

  const adesso = new Date();
  const sessione = sessioneUtc(adesso);
  if (sessione === "chiuso") {
    return no("Fuori sessioni operative (17:00-21:00 UTC). Session ORB spento.");
  }

  const taglio36h = adesso.getTime() - 36 * 60 * 60 * 1000;
  const recenti = m5.filter((b) => b.t.getTime() >= taglio36h);
  const asiaBars = recenti.filter((b) => inFinestra(b, 21, 7));
  const londraBars = recenti.filter((b) => inFinestra(b, 7, 12));
  const asiaBox = boxDa(asiaBars);
  const londraBox = boxDa(londraBars);
  const last = m5[m5.length - 1];

  if (sessione === "asia") {
    if (!asiaBox) return no("Asia: box non ancora formato (servono almeno 6 M5 della sessione).");
    return fadeAsia(prezzo, asiaBars.length >= 8 ? asiaBars : m5, asiaBox);
  }

  if (sessione === "londra") {
    if (!asiaBox) return no("Londra: range Asia assente, niente ORB.");
    if (asiaBox.size > BOX_MAX_ORB) {
      return no(`Londra: range Asia ${asiaBox.size.toFixed(2)}$ troppo largo. ORB spento.`);
    }
    return breakout(prezzo, last, asiaBox, "ORB Londra su range Asia");
  }

  // New York
  const londraCorsa = londraBox ? londraBox.size : 0;
  if (londraCorsa >= 20) {
    const compressione = boxDa(m5.slice(-12));
    if (!compressione) return no("NY: Londra ha già corso, manca un box M5 nuovo.");
    if (compressione.size > BOX_MAX_COMPRESSION) {
      return no(`NY: box recente ${compressione.size.toFixed(2)}$ troppo largo dopo la corsa di Londra.`);
    }
    return breakout(prezzo, last, compressione, "ORB NY su box M5 nuovo");
  }
  const boxNy = londraBox && londraBox.size <= BOX_MAX_ORB ? londraBox : asiaBox;
  if (!boxNy) return no("NY: nessun box Londra/Asia utilizzabile.");
  if (boxNy.size > BOX_MAX_ORB) {
    return no(`NY: box ${boxNy.size.toFixed(2)}$ troppo largo per l'ORB.`);
  }
  return breakout(prezzo, last, boxNy, "ORB NY su range Londra");
}
