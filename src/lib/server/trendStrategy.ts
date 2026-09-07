// ORB sul grafico M5, 24/5. Niente ICT, niente AI, niente filtri orari.
// Trova il box delle candele precedenti e entra sulla chiusura fuori.

export type DirezioneTrade = "BUY" | "SELL";
export type SetupNome = "orb";

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

const BOX_MIN = 5;
const BOX_MAX = 18;
const NO_CHASE = 8;
const SHOCK_M5 = 20;
const ORB_TP1_MIN = 12;
const ORB_TP2_MIN = 20;
const ORB_TP2_MAX = 30;
const MIN_RR = 1.5;
const LUNGHEZZE_BOX = [8, 10, 12, 16];

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

function boxDa(bars: Bar[]): { high: number; low: number; size: number; n: number } | null {
  if (bars.length < 6) return null;
  const high = Math.max(...bars.map((b) => b.h));
  const low = Math.min(...bars.map((b) => b.l));
  const size = Number((high - low).toFixed(2));
  if (!Number.isFinite(size) || size <= 0) return null;
  return { high: Number(high.toFixed(2)), low: Number(low.toFixed(2)), size, n: bars.length };
}

function scegliBox(prima: Bar[]): { high: number; low: number; size: number; n: number } | null {
  const candidati: { high: number; low: number; size: number; n: number }[] = [];
  for (const len of LUNGHEZZE_BOX) {
    if (prima.length < len) continue;
    const box = boxDa(prima.slice(-len));
    if (!box) continue;
    if (box.size < BOX_MIN || box.size > BOX_MAX) continue;
    candidati.push(box);
  }
  if (candidati.length === 0) return null;
  candidati.sort((a, b) => a.size - b.size);
  return candidati[0];
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
  if (m5.length < 14) return no("Candele M5 insufficienti per leggere il box.");

  const last = m5[m5.length - 1];
  const prima = m5.slice(0, -1);
  const box = scegliBox(prima);
  if (!box) {
    const grezzo = boxDa(prima.slice(-12));
    const size = grezzo ? grezzo.size.toFixed(2) : "?";
    return no(`Nessun box M5 valido (serve 5–18$). Range recente ${size}$.`);
  }

  if (last.h - last.l >= SHOCK_M5) {
    return no(`Candela M5 da ${(last.h - last.l).toFixed(1)}$: shock, non si insegue.`);
  }

  const closeBuy = last.c > box.high;
  const closeSell = last.c < box.low;
  if (!closeBuy && !closeSell) {
    return no(`Prezzo nel box ${box.low}–${box.high} (${box.size.toFixed(2)}$, ${box.n} M5). Aspetto chiusura fuori.`);
  }

  const direzione: DirezioneTrade = closeBuy ? "BUY" : "SELL";
  const bordo = direzione === "BUY" ? box.high : box.low;
  const oltre = Math.abs(last.c - bordo);
  if (oltre > NO_CHASE) {
    return no(`Chiusura già ${oltre.toFixed(1)}$ oltre il bordo ${bordo}. Niente inseguimento.`);
  }

  const entry = Number(prezzo.toFixed(2));
  const stopLoss = direzione === "BUY" ? box.low - 0.4 : box.high + 0.4;
  const rischio = Math.abs(entry - stopLoss);
  const tgt = orbTargets(rischio);
  const lv = livelli(direzione, entry, stopLoss, tgt.tp1, tgt.tp2);
  if (!lv) return no(`Breakout ${direzione} sul box ${box.size.toFixed(2)}$ ma R:R sotto 1.5.`);

  return {
    ok: true,
    direzione,
    entry,
    stopLoss: lv.stopLoss,
    tp1: lv.tp1,
    tp2: lv.tp2,
    rischioRendimento: lv.rr,
    zona: `box ${box.low}–${box.high}`,
    motivo: `ORB M5 ${direzione}. Box ${box.low}–${box.high} (${box.size.toFixed(2)}$, ${box.n} candele). Chiusura ${last.c.toFixed(2)} fuori. Stop lato opposto. TP1 ${lv.tp1} TP2 ${lv.tp2}. Nessun orario, nessun ICT.`,
    setup: "orb",
  };
}
