import { getSignalHistory, getLatestSignal, getSegnaleAttivo, getSegnaliInAttesa } from "./db";

export async function getDashboardSignals() {
  const [latest, history, attivo, inAttesa] = await Promise.all([
    getLatestSignal(),
    getSignalHistory(80),
    getSegnaleAttivo().catch(() => null),
    getSegnaliInAttesa().catch(() => [] as any[]),
  ]);

  const trades = history.filter((r: any) => r.direction === "BUY" || r.direction === "SELL");
  const current =
    attivo ??
    inAttesa?.[0] ??
    trades[0] ??
    latest;

  return {
    latest,
    current,
    history: trades.length > 0 ? trades : history,
  };
}
