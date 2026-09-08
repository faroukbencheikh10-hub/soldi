import { getCandeleChiuse } from "./dati";
import { getMapForWeek, getTradeForWeek, upsertResult } from "./repo";
import type { Zona } from "./types";
import { weekStartIso } from "./week";

function toccaZona(candele: { high: number; low: number }[], zona: Zona): boolean {
  if (zona.da == null || zona.a == null) return false;
  const lo = Math.min(zona.da, zona.a);
  const hi = Math.max(zona.da, zona.a);
  return candele.some((c) => c.high >= lo && c.low <= hi);
}

export async function scriviWeeklyResults(now = new Date()): Promise<void> {
  const week = weekStartIso(now);
  const map = await getMapForWeek(week);
  const trade = await getTradeForWeek(week);
  const daily = await getCandeleChiuse("1day", 10);
  const h1 = await getCandeleChiuse("1h", 80);

  const weekOpen = daily.filter((c) => c.datetime.slice(0, 10) >= week).at(-1)?.open ?? daily[0]?.open ?? null;
  const chiusura = daily[0]?.close ?? null;
  let direzioneReale: string | null = null;
  if (weekOpen != null && chiusura != null) {
    direzioneReale = chiusura > weekOpen ? "BUY" : chiusura < weekOpen ? "SELL" : "NEUTRALE";
  }

  const prevista = map?.mappa.direzione ?? null;
  const mappa = map?.mappa;
  const evento =
    mappa?.eventiChiave?.[0] != null
      ? `${mappa.eventiChiave[0].data} ${mappa.eventiChiave[0].oraUtc} ${mappa.eventiChiave[0].nome}`
      : null;

  await upsertResult({
    week_start: week,
    direzione_prevista: prevista,
    chiusura_weekly_reale: chiusura,
    direzione_reale: direzioneReale,
    mappa_corretta: prevista != null && direzioneReale != null ? prevista === direzioneReale : null,
    zona_buy_toccata: mappa ? toccaZona(h1, mappa.zonaBuy) : null,
    zona_sell_toccata: mappa ? toccaZona(h1, mappa.zonaSell) : null,
    trade_id: trade?.id ?? null,
    evento_dominante: evento,
  });
}
