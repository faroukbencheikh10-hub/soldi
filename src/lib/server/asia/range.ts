import { candeleNelFinestra, getCandeleChiuse } from "./dati";
import { getRange, insertLog, upsertRange } from "./repo";
import {
  giornoUtcIso,
  inizioGiornoUtc,
  isDopoCalcoloRange,
  isSessioneOperativa,
  isWeekendUtc,
  istanteUtc,
} from "./sessione";
import { RANGE_MAX_USD, RANGE_MIN_USD, type AsiaRangeRow, type CandleNum } from "./types";

const M5_ATTESI = 24;
const M5_MINIMI = 20;

export function rangeDaCandele(candele: CandleNum[]): {
  range_high: number;
  range_low: number;
  ampiezza: number;
} | null {
  if (candele.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const c of candele) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  return {
    range_high: Number(high.toFixed(2)),
    range_low: Number(low.toFixed(2)),
    ampiezza: Number((high - low).toFixed(2)),
  };
}

export function validaAmpiezza(ampiezza: number): { valido: boolean; motivo: string | null } {
  if (ampiezza < RANGE_MIN_USD || ampiezza > RANGE_MAX_USD) {
    return { valido: false, motivo: "range_non_valido" };
  }
  return { valido: true, motivo: null };
}

/**
 * Range di riferimento = high/low delle M5 CHIUSE con open in [00:00, 02:00) UTC.
 * Calcolato una volta dal primo cron >= 02:00 e salvato in asia_ranges.
 */
export async function ensureRange(now = new Date()): Promise<{
  range: AsiaRangeRow | null;
  created: boolean;
  skipped?: string;
}> {
  if (isWeekendUtc(now)) {
    return { range: null, created: false, skipped: "weekend_utc" };
  }
  const giorno = giornoUtcIso(now);
  const esistente = await getRange(giorno);
  const daRicalcolare =
    esistente &&
    !esistente.valido &&
    esistente.motivo === "range_dati_incompleti" &&
    isSessioneOperativa(now);
  if (esistente && !daRicalcolare) return { range: esistente, created: false };

  if (!isDopoCalcoloRange(now)) {
    return { range: null, created: false, skipped: "in_attesa_range" };
  }

  const m5 = await getCandeleChiuse("5min", 80, now.getTime());
  const da = inizioGiornoUtc(giorno);
  const a = istanteUtc(giorno, 2, 0);
  const finestra = candeleNelFinestra(m5, da, a);

  if (finestra.length < M5_MINIMI) {
    const row = await upsertRange({
      giorno,
      range_high: 0,
      range_low: 0,
      ampiezza: 0,
      valido: false,
      motivo: "range_dati_incompleti",
    });
    await insertLog("RANGE", {
      giorno,
      motivo: "range_dati_incompleti",
      n_candele: finestra.length,
      attese: M5_ATTESI,
    });
    await insertLog("NO_TRADE", { giorno, motivo: "range_dati_incompleti" });
    return { range: row, created: true };
  }

  const calc = rangeDaCandele(finestra);
  if (!calc) {
    const row = await upsertRange({
      giorno,
      range_high: 0,
      range_low: 0,
      ampiezza: 0,
      valido: false,
      motivo: "range_dati_incompleti",
    });
    await insertLog("NO_TRADE", { giorno, motivo: "range_dati_incompleti" });
    return { range: row, created: true };
  }

  const check = validaAmpiezza(calc.ampiezza);
  const row = await upsertRange({
    giorno,
    range_high: calc.range_high,
    range_low: calc.range_low,
    ampiezza: calc.ampiezza,
    valido: check.valido,
    motivo: check.motivo,
  });
  await insertLog("RANGE", {
    giorno,
    range_high: calc.range_high,
    range_low: calc.range_low,
    ampiezza: calc.ampiezza,
    valido: check.valido,
    motivo: check.motivo,
    n_candele: finestra.length,
  });
  if (!check.valido) {
    await insertLog("NO_TRADE", { giorno, motivo: "range_non_valido", ampiezza: calc.ampiezza });
  }
  return { range: row, created: true };
}
