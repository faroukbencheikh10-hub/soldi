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
  // Puramente informativo: dove spostare lo stop SE TP1 viene raggiunto e il
  // trade resta aperto verso TP2 (es. breakeven). Non entra in NESSUN calcolo
  // di validazione qui sotto (R:R, direzione, chiusura trade): e' solo un
  // suggerimento che attraversa la validazione senza essere verificato.
  stopLossTp2?: number | null;
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
      stopLossTp2: null,
      riskReward: 0,
      rejectedReason: `direzione "${raw.direction}" non riconosciuta`,
    };
  }

  if (normalized === "NO_TRADE") {
    return { ...raw, direction: "NO_TRADE" };
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
      stopLossTp2: null,
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
      stopLossTp2: null,
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
      stopLossTp2: null,
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
      stopLossTp2: null,
      riskReward: 0,
      rejectedReason: `${normalized} scartato: rapporto rischio/rendimento reale ${riskReward}, sotto il minimo ${MIN_RISK_REWARD} richiesto dalla strategia (TP1 deve distare almeno 1,5 volte lo stop)`,
    };
  }

  return { ...raw, direction: normalized, riskReward, stopAtrRatio };
}
