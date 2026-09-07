// Post-filtro: l'AI e il canale 5m non possono uscire CONTRO il Daily.
// Daily laterale o assente: nessun veto, la direzione la decide H1/M15.
// Restituisce lo stesso oggetto dell'AI (any) cosi' validateSignal vede ancora direction/entry/tp.
export function filtraSegnaleSulDaily(parsed: any, biasD1?: string | null): any {
  const daily =
    biasD1 === "rialzista" ? "BUY" : biasD1 === "ribassista" ? "SELL" : null;
  const dir = String(parsed?.direction ?? "").toUpperCase();
  if (dir !== "BUY" && dir !== "SELL") return parsed;
  if (!daily) return scontaConfidenceSeDailyLaterale(parsed, biasD1);
  if (dir !== daily) {
    const etichetta = daily === "BUY" ? "rialzista" : "ribassista";
    return {
      ...parsed,
      direction: "NO_TRADE",
      reasoning: `Setup ${dir} contro il bias Daily ${etichetta}: NO_TRADE.`,
    };
  }
  return parsed;
}

export function scontaConfidenceSeDailyLaterale<T extends { direction?: string; confidence?: unknown }>(
  signal: T,
  biasD1?: string | null
): T {
  const dir = String(signal?.direction ?? "").toUpperCase();
  if (dir !== "BUY" && dir !== "SELL") return signal;
  if (biasD1 === "rialzista" || biasD1 === "ribassista") return signal;
  const conf = Number(signal.confidence);
  if (!Number.isFinite(conf)) return signal;
  return { ...signal, confidence: Math.max(0, conf - 5) };
}
