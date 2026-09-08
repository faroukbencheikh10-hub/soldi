import { getMapForWeek, getLastSnapshot, getOpenTrade, getTradeForWeek, sumClosedPnl } from "./repo";
import { getPrezzoXau } from "./dati";
import { floating } from "./pnl";
import { weekStartIso } from "./week";

export async function getSettimanaState() {
  const week = weekStartIso();
  const [map, open, weekTrade, closed, prezzo] = await Promise.all([
    getMapForWeek(week),
    getOpenTrade(week),
    getTradeForWeek(week),
    sumClosedPnl(),
    getPrezzoXau(),
  ]);

  const snap = open ? await getLastSnapshot(open.id) : null;
  const live = open && prezzo ? floating(open, prezzo.price) : null;

  const weekUsd = closed.weekUsd + (live?.pnlUsd ?? 0);
  const weekR = closed.weekR + (live?.pnlR ?? 0);
  const totUsd = closed.totUsd + (live?.pnlUsd ?? 0);
  const totR = closed.totR + (live?.pnlR ?? 0);

  return {
    week_start: week,
    prezzo: prezzo?.price ?? "N/D",
    mappa: map
      ? {
          id: map.id,
          rigenerata: map.rigenerata,
          created_at: map.created_at,
          ...map.mappa,
        }
      : null,
    trade: open ?? weekTrade,
    snapshot: snap,
    floating: live,
    conto: {
      settimana: { usd: Number(weekUsd.toFixed(2)), r: Number(weekR.toFixed(3)) },
      totale: { usd: Number(totUsd.toFixed(2)), r: Number(totR.toFixed(3)) },
    },
    festivo_usa_liquidita_ridotta: null as string | null,
  };
}
