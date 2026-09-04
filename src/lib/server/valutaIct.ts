// Valutazione setup ICT senza pullback e senza veto H4.
// Sequenza: Judas -> CHoCH/BOS M15 -> displacement -> si entra subito a mercato.
// H4 e' calcolato a monte e passato all'AI come contesto: qui non blocca nulla.
export type DirezioneTrade = "BUY" | "SELL";

export interface SetupIctOriginale {
  ok: boolean;
  direzione: DirezioneTrade | null;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  rischioRendimento: number;
  zona: string | null;
  motivo: string;
}

const TP1_IN_R = 1.8;
const TP2_IN_R = 3.0;
const STOP_MIN_ATR = 0.4;
const STOP_FALLBACK_ATR = 1.2;

type Zona = { direzione: string; top: number; bottom: number; tipo: string };

export function valutaSetupIctOriginale(input: {
  prezzo: number;
  atr15m: number | null;
  strutturaM15?: { evento?: string | null; direzioneEvento?: string | null; bias?: string | null } | null;
  biasH1?: string | null;
  biasH4?: string | null;
  killZone?: { attuale?: string | null } | null;
  judas?: { rilevato?: boolean; direzioneFalsa?: string | null } | null;
  displacement15m?: { rilevato?: boolean; ampiezzaImpulsoInAtr?: number | null; direzione?: string | null } | null;
  orderBlocksM15?: { direzione: string; top: number; bottom: number }[] | null;
  fvgM15?: { direzione: string; top: number; bottom: number }[] | null;
  oteM15?: { prezzoDentro?: boolean; inizio?: number; fine?: number } | null;
}): SetupIctOriginale {
  const no = (motivo: string): SetupIctOriginale => ({
    ok: false,
    direzione: null,
    entry: null,
    stopLoss: null,
    tp1: null,
    tp2: null,
    rischioRendimento: 0,
    zona: null,
    motivo,
  });

  const prezzo = Number(input.prezzo);
  const atr = Number(input.atr15m);
  if (!Number.isFinite(prezzo) || prezzo <= 0) return no("Prezzo XAUUSD non disponibile.");
  if (!Number.isFinite(atr) || atr <= 0) return no("ATR15m non disponibile: non si dimensionano stop e target.");

  const evento = input.strutturaM15?.evento ?? null;
  const dirEv = input.strutturaM15?.direzioneEvento ?? null;
  if (evento !== "CHoCH" && evento !== "BOS") {
    return no(`Nessun CHoCH/BOS su M15 (evento ${String(evento)}). In ICT il setup non nasce dal solo bias.`);
  }
  if (dirEv !== "rialzista" && dirEv !== "ribassista") {
    return no("CHoCH/BOS M15 senza direzione.");
  }
  const direzione: DirezioneTrade = dirEv === "rialzista" ? "BUY" : "SELL";
  const dirZona = dirEv;

  const verso = (b?: string | null): DirezioneTrade | null =>
    b === "rialzista" ? "BUY" : b === "ribassista" ? "SELL" : null;
  const h1 = verso(input.biasH1 ?? null);
  if (h1 && direzione !== h1) {
    return no(`Setup M15 ${direzione} contro narrativa H1 ${h1}: in ICT non si trada contro H1.`);
  }

  const disp = input.displacement15m;
  const atrDisp = Number(disp?.ampiezzaImpulsoInAtr);
  const hasDisp = Number.isFinite(atrDisp) && atrDisp >= 1;
  if (!hasDisp) {
    return no("Manca il displacement M15 (impulso >= 1 ATR dopo CHoCH/BOS).");
  }

  const judas = input.judas;
  if (judas?.rilevato) {
    const falsa = judas.direzioneFalsa;
    if ((falsa === "rialzista" && direzione === "BUY") || (falsa === "ribassista" && direzione === "SELL")) {
      return no(`Judas Swing sulla direzione ${falsa}: e' il lato falso dell'apertura sessione. ICT prende il verso opposto.`);
    }
  }

  const zone: Zona[] = [
    ...(input.orderBlocksM15 ?? []).map((z) => ({ ...z, tipo: "Order Block M15" })),
    ...(input.fvgM15 ?? []).map((z) => ({ ...z, tipo: "FVG M15" })),
  ].filter((z) => z.direzione === dirZona && Number.isFinite(z.top) && Number.isFinite(z.bottom) && z.top > z.bottom);

  zone.sort((a, b) => {
    const stopA = direzione === "BUY" ? a.bottom : a.top;
    const stopB = direzione === "BUY" ? b.bottom : b.top;
    return Math.abs(prezzo - stopA) - Math.abs(prezzo - stopB);
  });
  const zona = zone[0] ?? null;

  const segno = direzione === "BUY" ? 1 : -1;
  const entry = Number(prezzo.toFixed(2));
  let stopLoss: number;
  let zonaTesto: string;
  if (zona) {
    const stopZona = direzione === "BUY" ? zona.bottom : zona.top;
    stopLoss = Number(stopZona.toFixed(2));
    zonaTesto = `${zona.tipo} ${dirZona} ${zona.bottom.toFixed(2)}-${zona.top.toFixed(2)}`;
  } else {
    stopLoss = Number((entry - segno * atr * STOP_FALLBACK_ATR).toFixed(2));
    zonaTesto = `stop ATR ${STOP_FALLBACK_ATR}`;
  }
  if (Math.abs(entry - stopLoss) < atr * STOP_MIN_ATR) {
    stopLoss = Number((entry - segno * atr * STOP_MIN_ATR).toFixed(2));
  }
  const rischio = Math.abs(entry - stopLoss);
  if (!(rischio > 0)) return no("Stop coincidente con l'entry.");
  const tp1 = Number((entry + segno * rischio * TP1_IN_R).toFixed(2));
  const tp2 = Number((entry + segno * rischio * TP2_IN_R).toFixed(2));

  return {
    ok: true,
    direzione,
    entry,
    stopLoss,
    tp1,
    tp2,
    rischioRendimento: TP1_IN_R,
    zona: zonaTesto,
    motivo: `ICT: ${evento} M15 ${dirZona}, displacement. Entrata a mercato a ${entry.toFixed(2)}. Stop su ${zonaTesto}. H4 solo contesto.`,
  };
}
