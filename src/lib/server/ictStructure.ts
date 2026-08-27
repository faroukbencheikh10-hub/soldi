interface RawCandle {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
}

function toNum(c: RawCandle) {
  return { open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) };
}

export interface Swing {
  tipo: "massimo" | "minimo";
  prezzo: number;
  indiceOriginale: number;
}

export function computeSwings(candles: RawCandle[]): Swing[] {
  if (!Array.isArray(candles) || candles.length < 3) return [];
  const cron = [...candles].reverse();
  const swings: Swing[] = [];

  for (let i = 1; i < cron.length - 1; i++) {
    const prev = toNum(cron[i - 1]);
    const curr = toNum(cron[i]);
    const next = toNum(cron[i + 1]);
    if (!Number.isFinite(curr.high) || !Number.isFinite(curr.low)) continue;

    if (curr.high > prev.high && curr.high > next.high) {
      swings.push({ tipo: "massimo", prezzo: curr.high, indiceOriginale: cron.length - 1 - i });
    } else if (curr.low < prev.low && curr.low < next.low) {
      swings.push({ tipo: "minimo", prezzo: curr.low, indiceOriginale: cron.length - 1 - i });
    }
  }

  return swings.sort((a, b) => b.indiceOriginale - a.indiceOriginale);
}

export interface StructureResult {
  bias: "rialzista" | "ribassista" | "laterale";
  evento: "BOS" | "CHoCH" | null;
  direzioneEvento: "rialzista" | "ribassista" | null;
  livelloRotto: number | null;
}

export function computeStructure(candles: RawCandle[]): StructureResult {
  const vuoto: StructureResult = { bias: "laterale", evento: null, direzioneEvento: null, livelloRotto: null };
  const swings = computeSwings(candles);
  if (swings.length < 4) return vuoto;

  const highs = swings.filter((s) => s.tipo === "massimo");
  const lows = swings.filter((s) => s.tipo === "minimo");
  if (highs.length < 2 || lows.length < 2) return vuoto;

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  let bias: StructureResult["bias"] = "laterale";
  if (lastHigh.prezzo > prevHigh.prezzo && lastLow.prezzo > prevLow.prezzo) bias = "rialzista";
  else if (lastHigh.prezzo < prevHigh.prezzo && lastLow.prezzo < prevLow.prezzo) bias = "ribassista";

  const prezzoAttuale = Number(candles[0]?.close);
  if (!Number.isFinite(prezzoAttuale)) return { ...vuoto, bias };

  let evento: StructureResult["evento"] = null;
  let direzioneEvento: StructureResult["direzioneEvento"] = null;
  let livelloRotto: number | null = null;

  if (bias === "rialzista") {
    if (prezzoAttuale > lastHigh.prezzo) {
      evento = "BOS";
      direzioneEvento = "rialzista";
      livelloRotto = lastHigh.prezzo;
    } else if (prezzoAttuale < lastLow.prezzo) {
      evento = "CHoCH";
      direzioneEvento = "ribassista";
      livelloRotto = lastLow.prezzo;
    }
  } else if (bias === "ribassista") {
    if (prezzoAttuale < lastLow.prezzo) {
      evento = "BOS";
      direzioneEvento = "ribassista";
      livelloRotto = lastLow.prezzo;
    } else if (prezzoAttuale > lastHigh.prezzo) {
      evento = "CHoCH";
      direzioneEvento = "rialzista";
      livelloRotto = lastHigh.prezzo;
    }
  }

  return { bias, evento, direzioneEvento, livelloRotto };
}

export interface OrderBlock {
  direzione: "rialzista" | "ribassista";
  top: number;
  bottom: number;
}

export function computeOrderBlocks(candles: RawCandle[]): OrderBlock[] {
  if (!Array.isArray(candles) || candles.length < 5) return [];
  const finestra = candles.slice(0, 20);
  let bullish: OrderBlock | null = null;
  let bearish: OrderBlock | null = null;

  for (let i = 0; i < finestra.length - 1 && (!bullish || !bearish); i++) {
    const impulso = toNum(finestra[i]);
    const precedente = toNum(finestra[i + 1]);
    if (![impulso, precedente].every((c) => Number.isFinite(c.open) && Number.isFinite(c.close))) continue;

    const range = impulso.high - impulso.low;
    if (range <= 0) continue;
    const corpo = Math.abs(impulso.close - impulso.open);
    if (corpo / range <= 0.6) continue;

    if (!bullish && impulso.close > impulso.open && precedente.close < precedente.open) {
      bullish = { direzione: "rialzista", top: precedente.high, bottom: precedente.low };
    }
    if (!bearish && impulso.close < impulso.open && precedente.close > precedente.open) {
      bearish = { direzione: "ribassista", top: precedente.high, bottom: precedente.low };
    }
  }

  const out: OrderBlock[] = [];
  if (bullish) out.push(bullish);
  if (bearish) out.push(bearish);
  return out;
}

export interface FVG {
  direzione: "rialzista" | "ribassista";
  top: number;
  bottom: number;
  mitigata: boolean;
}

export function computeFVG(candles: RawCandle[]): FVG[] {
  if (!Array.isArray(candles) || candles.length < 3) return [];
  const risultati: FVG[] = [];
  const finestra = candles.slice(0, 20);
  const prezzoAttuale = Number(candles[0]?.close);

  for (let i = 0; i < finestra.length - 2; i++) {
    const c = toNum(finestra[i]);
    const a = toNum(finestra[i + 2]);
    if (![a, c].every((x) => Number.isFinite(x.high) && Number.isFinite(x.low))) continue;

    if (c.low > a.high) {
      const top = c.low;
      const bottom = a.high;
      risultati.push({ direzione: "rialzista", top, bottom, mitigata: prezzoAttuale < bottom });
    } else if (c.high < a.low) {
      const top = a.low;
      const bottom = c.high;
      risultati.push({ direzione: "ribassista", top, bottom, mitigata: prezzoAttuale > top });
    }
  }

  return risultati.filter((f) => !f.mitigata).slice(0, 3);
}

export interface LivelliUguali {
  massimiUguali: number[];
  minimiUguali: number[];
}

export function computeEqualLevels(candles: RawCandle[], atr: number | null): LivelliUguali {
  const vuoto: LivelliUguali = { massimiUguali: [], minimiUguali: [] };
  if (atr === null || atr <= 0) return vuoto;
  const swings = computeSwings(candles);
  if (swings.length < 2) return vuoto;

  const tolleranza = atr * 0.15;
  const highs = swings.filter((s) => s.tipo === "massimo").map((s) => s.prezzo);
  const lows = swings.filter((s) => s.tipo === "minimo").map((s) => s.prezzo);

  function trovaCoppie(valori: number[]): number[] {
    const trovati: number[] = [];
    for (let i = 0; i < valori.length; i++) {
      for (let j = i + 1; j < valori.length; j++) {
        if (Math.abs(valori[i] - valori[j]) <= tolleranza) {
          const media = Number(((valori[i] + valori[j]) / 2).toFixed(2));
          if (!trovati.some((v) => Math.abs(v - media) <= tolleranza)) trovati.push(media);
        }
      }
    }
    return trovati;
  }

  return { massimiUguali: trovaCoppie(highs), minimiUguali: trovaCoppie(lows) };
}
