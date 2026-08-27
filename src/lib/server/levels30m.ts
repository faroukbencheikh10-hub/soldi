interface RawCandle {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
}

export interface LevelWindow30m {
  massimo: number;
  minimo: number;
  ampiezza: number;
  posizione: number;
  distanzaDalMassimo: number;
  distanzaDalMinimo: number;
}

export interface Momentum30m {
  direzione: "rialzo" | "ribasso" | "nessuna";
  candeleConsecutive: number;
}

export interface Levels30m {
  ultime2h: LevelWindow30m | null;
  ultime4h: LevelWindow30m | null;
  ultime8h: LevelWindow30m | null;
  rotturaRialzo: number | null;
  rotturaRibasso: number | null;
  rotturaRialzoInAtr: number | null;
  rotturaRibassoInAtr: number | null;
  momentum: Momentum30m | null;
}

function numeri(candles: RawCandle[], quante: number) {
  const fetta = candles.slice(0, quante);
  const massimi = fetta.map((c) => Number(c.high)).filter(Number.isFinite);
  const minimi = fetta.map((c) => Number(c.low)).filter(Number.isFinite);
  if (massimi.length === 0 || minimi.length === 0) return null;
  return { massimo: Math.max(...massimi), minimo: Math.min(...minimi) };
}

function finestra(candles: RawCandle[], quante: number, prezzo: number): LevelWindow30m | null {
  if (candles.length < quante) return null;
  const mm = numeri(candles, quante);
  if (!mm) return null;

  const ampiezza = mm.massimo - mm.minimo;
  const posizione = ampiezza > 0 ? (prezzo - mm.minimo) / ampiezza : 0.5;

  return {
    massimo: Number(mm.massimo.toFixed(2)),
    minimo: Number(mm.minimo.toFixed(2)),
    ampiezza: Number(ampiezza.toFixed(2)),
    posizione: Number(Math.min(1, Math.max(0, posizione)).toFixed(2)),
    distanzaDalMassimo: Number((mm.massimo - prezzo).toFixed(2)),
    distanzaDalMinimo: Number((prezzo - mm.minimo).toFixed(2)),
  };
}

function contaMomentum(candles: RawCandle[]): Momentum30m | null {
  if (!Array.isArray(candles) || candles.length === 0) return null;

  const direzioneCandela = (c: RawCandle): "rialzo" | "ribasso" | "nessuna" | null => {
    const open = Number(c.open);
    const close = Number(c.close);
    if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
    if (close > open) return "rialzo";
    if (close < open) return "ribasso";
    return "nessuna";
  };

  const prima = direzioneCandela(candles[0]);
  if (prima === null) return null;
  if (prima === "nessuna") return { direzione: "nessuna", candeleConsecutive: 0 };

  let count = 0;
  for (const c of candles) {
    const dir = direzioneCandela(c);
    if (dir === null || dir !== prima) break;
    count++;
  }

  return { direzione: prima, candeleConsecutive: count };
}

export function computeLevels30m(
  candles30m: RawCandle[] | undefined,
  prezzoAttuale: number,
  atr30m: number | null
): Levels30m {
  const vuoto: Levels30m = {
    ultime2h: null,
    ultime4h: null,
    ultime8h: null,
    rotturaRialzo: null,
    rotturaRibasso: null,
    rotturaRialzoInAtr: null,
    rotturaRibassoInAtr: null,
    momentum: null,
  };

  if (!Array.isArray(candles30m) || candles30m.length < 5) return vuoto;
  if (!Number.isFinite(prezzoAttuale)) return vuoto;

  const precedenti = candles30m.slice(1, 5);
  const mmPrec = numeri(precedenti, precedenti.length);

  let rotturaRialzo: number | null = null;
  let rotturaRibasso: number | null = null;

  if (mmPrec) {
    const sopra = prezzoAttuale - mmPrec.massimo;
    const sotto = mmPrec.minimo - prezzoAttuale;
    rotturaRialzo = sopra > 0 ? Number(sopra.toFixed(2)) : 0;
    rotturaRibasso = sotto > 0 ? Number(sotto.toFixed(2)) : 0;
  }

  const inAtr = (v: number | null) =>
    v !== null && atr30m !== null && atr30m > 0 ? Number((v / atr30m).toFixed(2)) : null;

  return {
    ultime2h: finestra(candles30m, 4, prezzoAttuale),
    ultime4h: finestra(candles30m, 8, prezzoAttuale),
    ultime8h: finestra(candles30m, 16, prezzoAttuale),
    rotturaRialzo,
    rotturaRibasso,
    rotturaRialzoInAtr: inAtr(rotturaRialzo),
    rotturaRibassoInAtr: inAtr(rotturaRibasso),
    momentum: contaMomentum(candles30m),
  };
}
