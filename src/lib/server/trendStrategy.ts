// Motore XAUUSD senza ICT e senza AI.
// Bias H4 con EMA + pullback Fibonacci + Judas Swing Londra.

export type DirezioneTrade = "BUY" | "SELL";

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
  setup: "pullback" | "judas" | null;
}

type Candle = {
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  datetime?: string;
};

const TP1_IN_R = 1.8;
const TP2_IN_R = 3.0;
const STOP_IN_ATR = 1.2;
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

function chiuse(candele: Candle[] | undefined): { o: number; h: number; l: number; c: number; t: Date | null }[] {
  if (!Array.isArray(candele) || candele.length === 0) return [];
  const out = [];
  for (let i = 1; i < candele.length; i++) {
    const row = candele[i];
    const o = n(row.open);
    const h = n(row.high);
    const l = n(row.low);
    const c = n(row.close);
    if (![o, h, l, c].every(Number.isFinite)) continue;
    out.push({ o, h, l, c, t: row.datetime ? new Date(row.datetime) : null });
  }
  return out;
}

function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((s, x) => s + x, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return Number(e.toFixed(2));
}

function adxApprox(bars: { h: number; l: number; c: number }[], period = 14): number | null {
  if (bars.length < period + 2) return null;
  let trSum = 0;
  let plusSum = 0;
  let minusSum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev) return null;
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    const up = cur.h - prev.h;
    const down = prev.l - cur.l;
    const plus = up > down && up > 0 ? up : 0;
    const minus = down > up && down > 0 ? down : 0;
    trSum += tr;
    plusSum += plus;
    minusSum += minus;
  }
  if (trSum <= 0) return null;
  const plusDi = (plusSum / trSum) * 100;
  const minusDi = (minusSum / trSum) * 100;
  const den = plusDi + minusDi;
  if (den <= 0) return null;
  return Number(((Math.abs(plusDi - minusDi) / den) * 100).toFixed(1));
}

function lastImpulse(bars: { h: number; l: number; c: number }[]): {
  high: number;
  low: number;
  direzione: DirezioneTrade;
} | null {
  if (bars.length < 8) return null;
  const window = bars.slice(-16);
  let hi = window[0].h;
  let lo = window[0].l;
  let hiI = 0;
  let loI = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].h >= hi) {
      hi = window[i].h;
      hiI = i;
    }
    if (window[i].l <= lo) {
      lo = window[i].l;
      loI = i;
    }
  }
  if (hi - lo <= 0) return null;
  const direzione: DirezioneTrade = hiI > loI ? "BUY" : "SELL";
  return { high: hi, low: lo, direzione };
}

function fibRetrace(impulse: { high: number; low: number; direzione: DirezioneTrade }, level: number): number {
  const range = impulse.high - impulse.low;
  return impulse.direzione === "BUY"
    ? Number((impulse.high - range * level).toFixed(2))
    : Number((impulse.low + range * level).toFixed(2));
}

function roundNumberVicino(prezzo: number): number {
  return Math.round(prezzo / 50) * 50;
}

function conferma15m(
  bars: { o: number; h: number; l: number; c: number }[],
  direzione: DirezioneTrade
): boolean {
  if (bars.length < 3) return false;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (direzione === "BUY") {
    const engulfing = last.c > last.o && last.c >= prev.o && last.o <= prev.c && last.c > prev.h * 0.999;
    const pin = last.c > last.o && last.l < last.o && last.c - last.o >= (last.o - last.l) * 0.4;
    const closeUp = last.c > last.o && last.c > prev.c;
    return engulfing || pin || closeUp;
  }
  const engulfing = last.c < last.o && last.c <= prev.o && last.o >= prev.c && last.c < prev.l * 1.001;
  const pin = last.c < last.o && last.h > last.o && last.o - last.c >= (last.h - last.o) * 0.4;
  const closeDown = last.c < last.o && last.c < prev.c;
  return engulfing || pin || closeDown;
}

function asianRange(h1: { h: number; l: number; t: Date | null }[]): { high: number; low: number } | null {
  const oggi = new Date();
  const pertinenti = h1.filter((b) => {
    if (!b.t || Number.isNaN(b.t.getTime())) return false;
    const hourUtc = b.t.getUTCHours();
    return hourUtc >= 21 || hourUtc < 6;
  });
  const pool = pertinenti.length >= 3 ? pertinenti : h1.slice(-8);
  if (pool.length < 3) return null;
  const taglio = oggi.getTime() - 18 * 60 * 60 * 1000;
  const recenti = pool.filter((b) => !b.t || b.t.getTime() >= taglio);
  const use = recenti.length >= 3 ? recenti : pool;
  return {
    high: Number(Math.max(...use.map((b) => b.h)).toFixed(2)),
    low: Number(Math.min(...use.map((b) => b.l)).toFixed(2)),
  };
}

function livelliTrade(
  direzione: DirezioneTrade,
  entry: number,
  stopStruttura: number,
  atr: number
): { stopLoss: number; tp1: number; tp2: number; rr: number } | null {
  const stopAtr = direzione === "BUY" ? entry - atr * STOP_IN_ATR : entry + atr * STOP_IN_ATR;
  const stopLoss =
    direzione === "BUY"
      ? Number(Math.min(stopStruttura, stopAtr).toFixed(2))
      : Number(Math.max(stopStruttura, stopAtr).toFixed(2));
  const rischio = Math.abs(entry - stopLoss);
  if (rischio < atr * 0.4) return null;
  const tp1 = Number((direzione === "BUY" ? entry + rischio * TP1_IN_R : entry - rischio * TP1_IN_R).toFixed(2));
  const tp2 = Number((direzione === "BUY" ? entry + rischio * TP2_IN_R : entry - rischio * TP2_IN_R).toFixed(2));
  const rr = Number((Math.abs(tp1 - entry) / rischio).toFixed(2));
  if (rr < MIN_RR) return null;
  return { stopLoss, tp1, tp2, rr };
}

export function valutaSetupTrend(input: {
  prezzo: number;
  atr15m: number | null;
  atr1h?: number | null;
  session?: { sessione?: string | null } | null;
  candles?: { "15m"?: Candle[]; "1h"?: Candle[]; "4h"?: Candle[] } | null;
}): SetupTrend {
  const prezzo = n(input.prezzo);
  const atr = n(input.atr15m);
  if (!Number.isFinite(prezzo) || prezzo <= 0) return no("Prezzo XAUUSD non disponibile.");
  if (!Number.isFinite(atr) || atr <= 0) return no("ATR15m non disponibile: non si dimensionano stop e target.");

  const sessione = input.session?.sessione ?? "asia";
  if (sessione !== "londra" && sessione !== "new_york" && sessione !== "londra_new_york") {
    return no(`Fuori sessione operativa (${sessione}). Si opera solo Londra, New York o overlap.`);
  }

  const h4 = chiuse(input.candles?.["4h"]);
  const h1 = chiuse(input.candles?.["1h"]);
  const m15 = chiuse(input.candles?.["15m"]);
  if (h4.length < 30) return no("Candele H4 insufficienti per EMA 21/50.");
  if (m15.length < 8) return no("Candele M15 insufficienti per la conferma.");

  const closesH4Chrono = [...h4].reverse().map((b) => b.c);
  const ema21 = ema(closesH4Chrono, 21);
  const ema50 = ema(closesH4Chrono, 50);
  if (ema21 === null || ema50 === null) return no("EMA H4 non calcolabile.");

  const adx = adxApprox([...h4].reverse(), 14);
  if (adx !== null && adx < 18) {
    return no(`Mercato laterale (ADX H4 ${adx}). Niente trend following.`);
  }

  let bias: DirezioneTrade | null = null;
  if (prezzo > ema21 && ema21 > ema50) bias = "BUY";
  else if (prezzo < ema21 && ema21 < ema50) bias = "SELL";
  if (!bias) {
    return no(`Nessun bias H4: prezzo ${prezzo.toFixed(2)}, EMA21 ${ema21}, EMA50 ${ema50}.`);
  }

  const impulse = lastImpulse([...h4].reverse());
  if (!impulse) return no("Impulso H4 non identificato.");

  const fib618 = fibRetrace(impulse, 0.618);
  const fib705 = fibRetrace(impulse, 0.705);
  const fib50 = fibRetrace(impulse, 0.5);
  const tondo = roundNumberVicino(prezzo);
  const zonaBassa = Math.min(fib618, fib705, fib50);
  const zonaAlta = Math.max(fib618, fib705, fib50);

  const vicinoTondo = Math.abs(prezzo - tondo) <= atr * 0.8;
  const inZonaFib =
    bias === "BUY"
      ? prezzo <= zonaAlta + atr * 0.25 && prezzo >= zonaBassa - atr * 0.35
      : prezzo >= zonaBassa - atr * 0.25 && prezzo <= zonaAlta + atr * 0.35;
  const vicinoEma = Math.abs(prezzo - ema21) <= atr * 0.9 || Math.abs(prezzo - ema50) <= atr * 1.1;

  const asia = asianRange(h1);
  const ultimaH1 = h1[0];
  let judas: { ok: true; direzione: DirezioneTrade; sweep: number } | null = null;
  if (asia && ultimaH1) {
    const sweepLow = ultimaH1.l < asia.low - atr * 0.02;
    const sweepHigh = ultimaH1.h > asia.high + atr * 0.02;
    if (sessione === "londra" || sessione === "londra_new_york") {
      if (sweepLow && ultimaH1.c > asia.low && bias === "BUY") {
        judas = { ok: true, direzione: "BUY", sweep: ultimaH1.l };
      } else if (sweepHigh && ultimaH1.c < asia.high && bias === "SELL") {
        judas = { ok: true, direzione: "SELL", sweep: ultimaH1.h };
      }
    }
  }

  if (judas && conferma15m([...m15].reverse(), judas.direzione)) {
    const entry = Number(prezzo.toFixed(2));
    const stopStruttura =
      judas.direzione === "BUY" ? judas.sweep - atr * 0.15 : judas.sweep + atr * 0.15;
    const lv = livelliTrade(judas.direzione, entry, Number(stopStruttura.toFixed(2)), atr);
    if (!lv) return no("Judas rilevato ma R:R sotto 1.5 dopo lo stop di struttura.");
    return {
      ok: true,
      direzione: judas.direzione,
      entry,
      stopLoss: lv.stopLoss,
      tp1: lv.tp1,
      tp2: lv.tp2,
      rischioRendimento: lv.rr,
      zona: asia ? `sweep Asia ${asia.low.toFixed(2)}-${asia.high.toFixed(2)}` : "sweep Londra",
      motivo: `Judas Swing Londra allineato al bias H4 ${bias}. EMA21 ${ema21} / EMA50 ${ema50}${adx !== null ? `, ADX ${adx}` : ""}. Stop oltre lo sweep, TP1 ${TP1_IN_R}R TP2 ${TP2_IN_R}R.`,
      setup: "judas",
    };
  }

  const confluenze = [inZonaFib, vicinoEma, vicinoTondo].filter(Boolean).length;
  if (confluenze < 2) {
    return no(`Bias ${bias} ma niente confluenza (fib ${inZonaFib ? "si" : "no"}, EMA ${vicinoEma ? "si" : "no"}, tondo ${tondo} ${vicinoTondo ? "si" : "no"}). Aspetto il pullback.`);
  }
  if (impulse.direzione !== bias) {
    return no(`Impulso H4 ${impulse.direzione} diverso dal bias ${bias}: niente inseguimento.`);
  }
  if (!conferma15m([...m15].reverse(), bias)) {
    return no(`Zona di pullback ${bias} raggiunta, manca conferma M15 (engulfing/pin/chiusura).`);
  }

  const entry = Number((bias === "BUY" ? Math.min(prezzo, zonaAlta) : Math.max(prezzo, zonaBassa)).toFixed(2));
  const stopStruttura =
    bias === "BUY"
      ? Math.min(impulse.low, zonaBassa) - atr * 0.15
      : Math.max(impulse.high, zonaAlta) + atr * 0.15;
  const lv = livelliTrade(bias, entry, Number(stopStruttura.toFixed(2)), atr);
  if (!lv) return no("Pullback valido ma stop troppo stretto o R:R < 1.5.");

  return {
    ok: true,
    direzione: bias,
    entry,
    stopLoss: lv.stopLoss,
    tp1: lv.tp1,
    tp2: lv.tp2,
    rischioRendimento: lv.rr,
    zona: `Fib ${zonaBassa.toFixed(2)}-${zonaAlta.toFixed(2)} · EMA21 ${ema21} · tondo ${tondo}`,
    motivo: `Pullback di trend H4 ${bias}. Confluenze: ${confluenze}/3 (Fib 50-70.5, EMA 21/50, livello tondo ${tondo}).${adx !== null ? ` ADX ${adx}.` : ""} Stop struttura, TP1 ${TP1_IN_R}R, TP2 ${TP2_IN_R}R. Nessun ICT, nessuna AI.`,
    setup: "pullback",
  };
}
