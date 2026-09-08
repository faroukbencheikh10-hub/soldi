import { ensureMappa } from "./mappa";
import {
  getOpenTrade,
  getTradeForWeek,
  markDone,
  markError,
  releaseLock,
  tryAcquireLock,
} from "./repo";
import { chiusuraVenerdi, snapshotTradeAperto, verificaEsiti } from "./esiti";
import { ricercaIngresso } from "./ingresso";
import { scriviWeeklyResults } from "./results";
import { isFridayAfterUtc, isWeekendUtc, weekStartIso } from "./week";

export async function runSettimana(now = new Date()): Promise<Record<string, unknown>> {
  if (isWeekendUtc(now)) {
    return { ok: true, skipped: "weekend_utc" };
  }

  const locked = await tryAcquireLock();
  if (!locked) return { ok: true, skipped: "lock" };

  const steps: string[] = [];
  try {
    const week = weekStartIso(now);
    let open = await getOpenTrade(week);

    if (open) {
      await snapshotTradeAperto(open);
      steps.push("snapshot");
      open = (await getOpenTrade(week)) ?? open;
      const esito = await verificaEsiti(open);
      if ("chiuso" in esito) {
        steps.push(`esito:${esito.esito}`);
        open = null;
      } else {
        steps.push("esito:ancora_aperto");
        open = esito;
      }
    }

    if (open) {
      const friday = await chiusuraVenerdi(open, now);
      if (friday) {
        steps.push("friday_close");
        open = null;
      }
    }

    const map = await ensureMappa(now);
    steps.push(`mappa:${map.mappa.direzione}${map.rigenerata ? ":rigenerata" : ""}`);

    if (!open) {
      const gia = await getTradeForWeek(week);
      if (gia) {
        steps.push("ingresso:gia_un_trade");
      } else {
        const ing = await ricercaIngresso(map, now);
        steps.push(`ingresso:${ing.opened ? "aperto" : ing.motivo}`);
      }
    } else {
      steps.push("ingresso:skip_open");
    }

    if (isFridayAfterUtc(now, 20, 0)) {
      await scriviWeeklyResults(now);
      steps.push("sett_results");
    }

    await markDone();
    return { ok: true, week_start: week, steps };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(msg);
    throw err;
  } finally {
    await releaseLock();
  }
}
