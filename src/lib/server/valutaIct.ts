// Valutazione setup ICT (Huddleston) senza veto orario.
// Sequenza: Judas -> CHoCH/BOS M15 -> displacement ->
// pullback in Order Block / FVG (meglio in OTE 62-79%) -> si entra.
// Il segnale nasce SOLO quando il prezzo e' gia' in zona.
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
const TOLL_ZONA_ATR = 0.15;

type Zona = { direzione: string; top: number; bottom: number; tipo: string };

function dentroZona(prezzo: number, z: Zona, atr: number): boolean {
  const t = Math.max(0, atr) * TOLL_ZONA_ATR;
  return prezzo <= z.top + t && prezzo >= z.bottom - t;
}

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
  const h4 = verso(input.biasH4 ?? null);
  const narrativa = h1 ?? h4;
  const fonte = h1 ? "H1" : h4 ? "H4" : null;
  if (narrativa && direzione !== narrativa) {
    return no(`Setup M15 ${direzione} contro narrativa ${fonte} ${narrativa}: in ICT non si trada contro H1/H4.`);
  }

  const disp = input.displacement15m;
  const atrDisp = Number(disp?.ampiezzaImpulsoInAtr);
  const hasDisp = Number.isFinite(atrDisp) && atrDisp >= 1;
  if (!hasDisp) {
    return no("Manca il displacement M15 (impulso >= 1 ATR dopo CHoCH/BOS). Senza displacement non c'e' FVG/OB valido.");
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

  if (zone.length === 0) {
    return no(`Nessuna zona M15 ${dirZona} (Order Block / FVG). In ICT l'entry e' solo sul PD array.`);
  }

  const ote = input.oteM15;
  const oteLo = Number(ote?.inizio);
  const oteHi = Number(ote?.fine);
  const oteBasso = Number.isFinite(oteLo) && Number.isFinite(oteHi) ? Math.min(oteLo, oteHi) : null;
  const oteAlto = Number.isFinite(oteLo) && Number.isFinite(oteHi) ? Math.max(oteLo, oteHi) : null;

  const occupate = zone.filter((z) => dentroZona(prezzo, z, atr));
  if (occupate.length === 0) {
    return no("Prezzo fuori dalla zona di pullback M15. ICT non insegue il displacement: si aspetta il ritorno in OB/FVG.");
  }

  occupate.sort((a, b) => {
    const aOte = oteBasso !== null && a.bottom <= oteAlto! && a.top >= oteBasso ? 1 : 0;
    const bOte = oteBasso !== null && b.bottom <= oteAlto! && b.top >= oteBasso ? 1 : 0;
    return bOte - aOte;
  });
  const zona = occupate[0];

  const segno = direzione === "BUY" ? 1 : -1;
  const entry = Number(prezzo.toFixed(2));
  const stopZona = direzione === "BUY" ? zona.bottom : zona.top;
  let stopLoss = Number(stopZona.toFixed(2));
  if (Math.abs(entry - stopLoss) < atr * 0.4) {
    stopLoss = Number((entry - segno * atr * 0.4).toFixed(2));
  }
  const rischio = Math.abs(entry - stopLoss);
  if (!(rischio > 0)) return no("Stop coincidente con l'entry.");
  const tp1 = Number((entry + segno * rischio * TP1_IN_R).toFixed(2));
  const tp2 = Number((entry + segno * rischio * TP2_IN_R).toFixed(2));

  const oteNota = oteBasso !== null && zona.bottom <= oteAlto! && zona.top >= oteBasso ? " in fascia OTE" : "";

  return {
    ok: true,
    direzione,
    entry,
    stopLoss,
    tp1,
    tp2,
    rischioRendimento: TP1_IN_R,
    zona: `${zona.tipo} ${dirZona} ${zona.bottom.toFixed(2)}-${zona.top.toFixed(2)}${oteNota}`,
    motivo: `ICT: ${evento} M15 ${dirZona}, displacement, pullback su ${zona.tipo}${oteNota}. Entrata a mercato in zona a ${entry.toFixed(2)}.`,
  };
}
