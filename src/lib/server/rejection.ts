interface RawCandle {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
}

export interface RejectionSignal {
  rilevato: boolean;
  direzione: "rialzista" | "ribassista" | null;
  ampiezzaImpulsoInAtr: number | null;
  percentualeRitracciata: number | null;
}

function toNum(c: RawCandle) {
  return {
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  };
}

export function computeRejection(
  candles: RawCandle[] | undefined,
  atr: number | null
): RejectionSignal {
  const vuoto: RejectionSignal = {
    rilevato: false,
    direzione: null,
    ampiezzaImpulsoInAtr: null,
    percentualeRitracciata: null,
  };

  if (!Array.isArray(candles) || candles.length < 2) return vuoto;

  const attuale = toNum(candles[0]);
  const impulso = toNum(candles[1]);

  const tutti = [attuale.open, attuale.high, attuale.low, attuale.close, impulso.open, impulso.high, impulso.low, impulso.close];
  if (!tutti.every(Number.isFinite)) return vuoto;

  const rangeImpulso = impulso.high - impulso.low;
  if (rangeImpulso <= 0) return vuoto;

  const impulsoRialzista = impulso.close > impulso.open;
  const impulsoRibassista = impulso.close < impulso.open;
  if (!impulsoRialzista && !impulsoRibassista) return vuoto;

  let percentualeRitracciata: number;
  let direzioneRigetto: "rialzista" | "ribassista";

  if (impulsoRialzista) {
    percentualeRitracciata = (impulso.high - attuale.close) / rangeImpulso;
    direzioneRigetto = "ribassista";
  } else {
    percentualeRitracciata = (attuale.close - impulso.low) / rangeImpulso;
    direzioneRigetto = "rialzista";
  }

  const ampiezzaImpulsoInAtr =
    atr !== null && atr > 0 ? Number((rangeImpulso / atr).toFixed(2)) : null;

  const rilevato =
    ampiezzaImpulsoInAtr !== null &&
    ampiezzaImpulsoInAtr >= 0.8 &&
    percentualeRitracciata >= 0.5;

  return {
    rilevato,
    direzione: rilevato ? direzioneRigetto : null,
    ampiezzaImpulsoInAtr,
    percentualeRitracciata: Number(Math.max(0, percentualeRitracciata).toFixed(2)),
  };
}
