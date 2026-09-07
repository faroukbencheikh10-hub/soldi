// Post-filtro: l'AI e il canale 5m non possono uscire contro il Daily.
// Restituisce lo stesso oggetto dell'AI (any) cosi' validateSignal vede ancora direction/entry/tp.
export function filtraSegnaleSulDaily(parsed: any, biasD1?: string | null): any {
  const daily =
    biasD1 === "rialzista" ? "BUY" : biasD1 === "ribassista" ? "SELL" : null;
  const dir = String(parsed?.direction ?? "").toUpperCase();
  if (dir !== "BUY" && dir !== "SELL") return parsed;
  if (!daily) {
    return {
      ...parsed,
      direction: "NO_TRADE",
      reasoning: `Daily laterale o assente (${String(biasD1)}): nessuna direzione. ${String(parsed?.reasoning ?? "")}`,
    };
  }
  if (dir !== daily) {
    return {
      ...parsed,
      direction: "NO_TRADE",
      reasoning: `Setup ${dir} contro Daily ${daily}: il Daily decide. ${String(parsed?.reasoning ?? "")}`,
    };
  }
  return parsed;
}
