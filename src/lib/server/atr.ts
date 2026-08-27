interface RawCandle {
  open: string;
  high: string;
  low: string;
  close: string;
  datetime: string;
}

export function computeATR(candles: RawCandle[] | undefined, period = 14): number | null {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const trueRanges: number[] = [];

  for (let i = 0; i < period; i++) {
    const current = candles[i];
    const previous = candles[i + 1];
    if (!current || !previous) return null;

    const high = Number(current.high);
    const low = Number(current.low);
    const prevClose = Number(previous.close);

    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) {
      return null;
    }

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length === 0) return null;

  const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
  return Number.isFinite(atr) ? Number(atr.toFixed(2)) : null;
}
