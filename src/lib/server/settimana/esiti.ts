import { sendPushToAll } from "@/lib/server/pushSend";
import { getCandeleChiuse, getPrezzoXau } from "./dati";
import {
  closeTrade,
  insertLog,
  insertSnapshot,
  updateTradeMfeMae,
} from "./repo";
import type { EsitoTrade, SettTradeRow } from "./types";
import { giorniAperti, isFridayAfterUtc } from "./week";
import { floating, mergeMfeMae, rDaPrezzo, slEffettivo, usdDaR } from "./pnl";

type Candle = { open: number; high: number; low: number; close: number; datetime: string };

function toccaSl(direzione: "BUY" | "SELL", slEff: number, c: Candle): boolean {
  return direzione === "BUY" ? c.low <= slEff : c.high >= slEff;
}
function toccaTp(direzione: "BUY" | "SELL", tp: number, c: Candle): boolean {
  return direzione === "BUY" ? c.high >= tp : c.low <= tp;
}

export function valutaM5(
  trade: SettTradeRow,
  candeleAsc: Candle[]
): { esito: EsitoTrade; r: number; chiusoIl: string; dettaglio: string } | null {
  const slEff = slEffettivo(trade.direzione, trade.sl);
  const risk = Math.abs(trade.entry - trade.sl);
  if (risk <= 0) return null;
  const rTp1 = (trade.direzione === "BUY" ? trade.tp1 - trade.entry : trade.entry - trade.tp1) / risk;
  const rTp2 = (trade.direzione === "BUY" ? trade.tp2 - trade.entry : trade.entry - trade.tp2) / risk;

  let tp1Hit = false;
  for (const c of candeleAsc) {
    const sl = toccaSl(trade.direzione, slEff, c);
    const tp1 = toccaTp(trade.direzione, trade.tp1, c);
    const tp2 = toccaTp(trade.direzione, trade.tp2, c);
    if (sl && (tp1 || tp2)) {
      return { esito: "LOSS", r: -1, chiusoIl: c.datetime, dettaglio: "SL e TP stessa M5" };
    }
    if (sl) {
      if (tp1Hit) {
        return {
          esito: "WIN_PARZIALE",
          r: Number(rTp1.toFixed(3)),
          chiusoIl: c.datetime,
          dettaglio: "TP1 poi SL",
        };
      }
      return { esito: "LOSS", r: -1, chiusoIl: c.datetime, dettaglio: "SL toccato" };
    }
    if (tp2) {
      return { esito: "WIN", r: Number(rTp2.toFixed(3)), chiusoIl: c.datetime, dettaglio: "TP2 toccato" };
    }
    if (tp1) tp1Hit = true;
  }
  return null;
}

async function pushChiusura(trade: SettTradeRow, esito: EsitoTrade, r: number | null) {
  sendPushToAll({
    title: "Trade della settimana — chiuso",
    body: `${trade.direzione} ${esito}${r != null ? ` ${r.toFixed(2)}R` : ""}`,
    url: "/",
    tag: "sett-esito",
  }).catch((err) => console.error("[settimana] push chiusura:", err));
}

export async function snapshotTradeAperto(trade: SettTradeRow): Promise<void> {
  const q = await getPrezzoXau();
  if (!q) {
    await insertLog("CHECK", { motivo: "snapshot prezzo N/D", trade_id: trade.id });
    return;
  }
  const { pnlR, pnlUsd } = floating(trade, q.price);
  await insertSnapshot(trade.id, q.price, pnlR ?? 0, pnlUsd);
  const { mfe, mae } = mergeMfeMae(
    trade.direzione,
    trade.entry,
    q.price,
    q.price,
    trade.mfe_usd,
    trade.mae_usd
  );
  await updateTradeMfeMae(trade.id, mfe, mae);
}

export async function verificaEsiti(trade: SettTradeRow): Promise<SettTradeRow | { chiuso: true; esito: EsitoTrade }> {
  const m5 = await getCandeleChiuse("5min", 400);
  const from = new Date(trade.aperto_il).getTime();
  const dopo = m5
    .filter((c) => {
      const t = new Date(c.datetime).getTime();
      return Number.isFinite(t) && t >= from;
    })
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

  if (dopo.length > 0) {
    const highs = dopo.map((c) => c.high);
    const lows = dopo.map((c) => c.low);
    const { mfe, mae } = mergeMfeMae(
      trade.direzione,
      trade.entry,
      Math.max(...highs),
      Math.min(...lows),
      trade.mfe_usd,
      trade.mae_usd
    );
    await updateTradeMfeMae(trade.id, mfe, mae);
    trade = { ...trade, mfe_usd: mfe, mae_usd: mae };
  }

  const hit = valutaM5(trade, dopo);
  if (!hit) return trade;

  const pnlUsd = usdDaR(hit.r, trade.entry, trade.sl);
  await closeTrade(trade.id, {
    esito: hit.esito,
    r_finale: hit.r,
    pnl_usd: pnlUsd,
    mfe_usd: trade.mfe_usd,
    mae_usd: trade.mae_usd,
    giorni_in_trade: giorniAperti(trade.aperto_il, hit.chiusoIl),
    chiuso_il: hit.chiusoIl,
  });
  await insertLog("ESITO", {
    trade_id: trade.id,
    esito: hit.esito,
    r: hit.r,
    dettaglio: hit.dettaglio,
    chiuso_il: hit.chiusoIl,
  });
  await pushChiusura(trade, hit.esito, hit.r);
  return { chiuso: true, esito: hit.esito };
}

export async function chiusuraVenerdi(trade: SettTradeRow, now = new Date()): Promise<boolean> {
  if (!isFridayAfterUtc(now, 20, 0)) return false;
  const q = await getPrezzoXau();
  const price = q?.price ?? null;
  const r = price != null ? rDaPrezzo(trade.direzione, trade.entry, trade.sl, price) : null;
  const pnlUsd = r != null ? usdDaR(r, trade.entry, trade.sl) : null;
  await closeTrade(trade.id, {
    esito: "FRIDAY_CLOSE",
    r_finale: r,
    pnl_usd: pnlUsd,
    giorni_in_trade: giorniAperti(trade.aperto_il, now.toISOString()),
    chiuso_il: now.toISOString(),
    nota: `\n[FRIDAY_CLOSE prezzo ${price ?? "N/D"}]`,
  });
  await insertLog("FRIDAY_CLOSE", { trade_id: trade.id, price: price ?? "N/D", r, pnlUsd });
  await pushChiusura(trade, "FRIDAY_CLOSE", r);
  return true;
}

export async function chiusuraManuale(
  trade: SettTradeRow,
  motivo: string,
  now = new Date()
): Promise<void> {
  const q = await getPrezzoXau();
  const price = q?.price ?? null;
  const r = price != null ? rDaPrezzo(trade.direzione, trade.entry, trade.sl, price) : null;
  const pnlUsd = r != null ? usdDaR(r, trade.entry, trade.sl) : null;
  await closeTrade(trade.id, {
    esito: "MANUAL_CLOSE",
    r_finale: r,
    pnl_usd: pnlUsd,
    giorni_in_trade: giorniAperti(trade.aperto_il, now.toISOString()),
    chiuso_il: now.toISOString(),
    nota: `\n[MANUAL_CLOSE ${motivo || "n/d"} prezzo ${price ?? "N/D"}]`,
  });
  await insertLog("ESITO", { trade_id: trade.id, esito: "MANUAL_CLOSE", motivo, price: price ?? "N/D", r });
  await pushChiusura(trade, "MANUAL_CLOSE", r);
}
