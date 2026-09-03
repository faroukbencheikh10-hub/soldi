// Rapporto rischio/rendimento minimo. La strategia lo chiede gia' nel prompt
// ("TP1 almeno 1,5 volte la distanza dello stop") ma finora nessuno lo
// verificava: 81 trade su 113 in 7 giorni erano sotto questa soglia, con un
// caso a 0,67 (si rischiava 1 per guadagnare 0,67). Ora il controllo e' vero.
const MIN_RISK_REWARD = 1.5;

export interface RawSignal {
  direction: string;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskReward: number | null;
  confidence: number;
  reasoning: string;
  [key: string]: unknown;
}

export interface ValidatedSignal extends RawSignal {
  direction: "BUY" | "SELL" | "NO_TRADE";
  rejectedReason?: string;
  stopAtrRatio?: number | null;
}

function normalizeDirection(raw: string): "BUY" | "SELL" | "NO_TRADE" | null {
  const d = (raw ?? "").toString().trim().toUpperCase();
  if (d === "BUY" || d === "LONG") return "BUY";
  if (d === "SELL" || d === "SHORT") return "SELL";
  if (d === "NO_TRADE" || d === "NOTRADE" || d === "NO TRADE") return "NO_TRADE";
  return null;
}

export function validateSignal(raw: RawSignal, atrField: "atr15m" | "atr5m" = "atr15m"): ValidatedSignal {
  const normalized = normalizeDirection(raw.direction);

  if (normalized === null) {
    return {
      ...raw,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
      rejectedReason: `direzione "${raw.direction}" non riconosciuta`,
    };
  }

  if (normalized === "NO_TRADE") {
    // Livelli azzerati (03/09). Prima si restituiva "{ ...raw }", cioe' si
    // tenevano i numeri che l'AI aveva scritto. Finche' l'AI lasciava quei
    // campi a zero sui NO_TRADE non si notava, ma da quando le si chiede di
    // usare il prezzo corrente come entry ha cominciato a compilarli tutti,
    // e su un NO_TRADE possono descrivere due direzioni opposte insieme:
    // un caso reale aveva entry 4491.70, TP1 4510.81 (sopra) e TP2 4466.18
    // (sotto), cioe' il bersaglio rialzista e quello ribassista nello stesso
    // segnale.
    //
    // Su un NO_TRADE non esiste nessun trade, quindi non esistono livelli:
    // mostrarne di incoerenti in dashboard confonde e basta. La spiegazione
    // resta, ed e' li' che si legge cosa ha visto l'AI.
    return {
      ...raw,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
    };
  }

  const { entry, stopLoss, tp1 } = raw;

  if (entry === null || stopLoss === null || tp1 === null) {
    return {
      ...raw,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
      rejectedReason: `${normalized} scartato: entry/stopLoss/tp1 mancanti`,
    };
  }

  const snapshot = raw.marketSnapshot as { atr15m?: number | null; atr5m?: number | null } | undefined;
  const atr = snapshot?.[atrField] ?? null;
  const stopDistance = Math.abs(entry - stopLoss);
  const stopAtrRatio =
    atr !== null && atr > 0 ? Number((stopDistance / atr).toFixed(2)) : null;

  const validBuy = normalized === "BUY" && stopLoss < entry && entry < tp1;
  const validSell = normalized === "SELL" && tp1 < entry && entry < stopLoss;

  if (normalized === "BUY" && !validBuy) {
    return {
      ...raw,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
      rejectedReason: `BUY scartato: richiesto SL < Entry < TP1, ricevuto SL=${stopLoss} Entry=${entry} TP1=${tp1}`,
    };
  }

  if (normalized === "SELL" && !validSell) {
    return {
      ...raw,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
      rejectedReason: `SELL scartato: richiesto TP1 < Entry < SL, ricevuto TP1=${tp1} Entry=${entry} SL=${stopLoss}`,
    };
  }

  // Il rapporto NON e' quello dichiarato dall'AI ma quello calcolato dai suoi
  // stessi numeri: entry, stop e TP1. Prima l'AI dichiarava in media 1,32
  // mentre i suoi numeri valevano 1,25.
  const reward = Math.abs(tp1 - entry);
  const riskReward = stopDistance > 0 ? Number((reward / stopDistance).toFixed(2)) : 0;

  if (riskReward < MIN_RISK_REWARD) {
    return {
      ...raw,
      direction: "NO_TRADE",
      entry: 0,
      stopLoss: 0,
      tp1: 0,
      tp2: 0,
      riskReward: 0,
      rejectedReason: `${normalized} scartato: rapporto rischio/rendimento reale ${riskReward}, sotto il minimo ${MIN_RISK_REWARD} richiesto dalla strategia (TP1 deve distare almeno 1,5 volte lo stop)`,
    };
  }

  return { ...raw, direction: normalized, riskReward, stopAtrRatio };
}
