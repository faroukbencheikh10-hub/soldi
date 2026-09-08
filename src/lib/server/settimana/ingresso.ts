import { computeATR } from "@/lib/server/atr";
import { sendPushToAll } from "@/lib/server/pushSend";
import { compactCandles, getCandeleChiuse, getPrezzoXau } from "./dati";
import { callOpenAiJson, openaiModel } from "./openai";
import { insertLog, insertTrade } from "./repo";
import { STOP_MAX_USD, STOP_MIN_USD, type MappaSettimana, type SettMapRow, type Zona } from "./types";
import { insideWindow, isFridayAfterUtc, weekdayUtcName, weekStartIso } from "./week";
import { rischioPrezzo } from "./pnl";

const ENTRY_PROMPT = `Sei un esecutore ICT su XAUUSD. Hai già una mappa settimanale e un setup H1 confermato dal codice.
Devi dare un ingresso ESEGUIBILE SUBITO al prezzo corrente. Nessun ordine pendente.
JSON obbligatorio:
{
  "direzione": "BUY"|"SELL",
  "entry": number,
  "sl": number,
  "tp1": number,
  "tp2": number,
  "confidence": number,
  "spiegazione": "max 3 righe"
}
Regole: direzione = mappa; sl 25-80 $ dall'entry; tp1 ≥ 2R; tp2 ≥ 3R; entry ≈ prezzo corrente.
Se i dati non bastano: { "direzione": "NO_TRADE", "spiegazione": "motivo" }. Non inventare livelli.`;

function inZona(price: number, zona: Zona): boolean {
  if (zona.da == null || zona.a == null) return false;
  const lo = Math.min(zona.da, zona.a);
  const hi = Math.max(zona.da, zona.a);
  return price >= lo && price <= hi;
}

export function sweepEDisplacement(
  h1: { open: number; high: number; low: number; close: number }[],
  direzione: "BUY" | "SELL",
  atr: number | null
): { ok: boolean; motivo: string } {
  if (!atr || atr <= 0) return { ok: false, motivo: "ATR(H1) N/D" };
  if (h1.length < 8) return { ok: false, motivo: "H1 insufficienti" };
  const last = h1[0];
  const lookback = h1.slice(1, 16);
  const body = last.close - last.open;
  if (direzione === "BUY") {
    const recentLow = Math.min(...lookback.map((c) => c.low));
    const sweep = last.low < recentLow;
    const recovery = last.close > recentLow;
    const disp = body >= atr && last.close > last.open;
    if (!sweep) return { ok: false, motivo: "nessuno sweep del low recente su H1" };
    if (!recovery) return { ok: false, motivo: "sweep low senza chiusura di recupero" };
    if (!disp) return { ok: false, motivo: `displacement BUY < 1 ATR (${body.toFixed(2)} vs ${atr})` };
    return { ok: true, motivo: `sweep low ${recentLow.toFixed(2)} + displacement ${body.toFixed(2)}` };
  }
  const recentHigh = Math.max(...lookback.map((c) => c.high));
  const sweep = last.high > recentHigh;
  const recovery = last.close < recentHigh;
  const disp = -body >= atr && last.close < last.open;
  if (!sweep) return { ok: false, motivo: "nessuno sweep del high recente su H1" };
  if (!recovery) return { ok: false, motivo: "sweep high senza chiusura di recupero" };
  if (!disp) return { ok: false, motivo: `displacement SELL < 1 ATR (${Math.abs(body).toFixed(2)} vs ${atr})` };
  return { ok: true, motivo: `sweep high ${recentHigh.toFixed(2)} + displacement ${Math.abs(body).toFixed(2)}` };
}

function validaLivelli(
  direzione: "BUY" | "SELL",
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  prezzo: number
): string | null {
  if (![entry, sl, tp1, tp2, prezzo].every(Number.isFinite)) return "livelli non numerici";
  if (Math.abs(entry - prezzo) > 3) return `entry ${entry} oltre 3$ dal prezzo ${prezzo}`;
  const stop = rischioPrezzo(entry, sl);
  if (stop < STOP_MIN_USD || stop > STOP_MAX_USD) return `stop ${stop.toFixed(2)}$ fuori 25-80`;
  const r1 = (direzione === "BUY" ? tp1 - entry : entry - tp1) / stop;
  const r2 = (direzione === "BUY" ? tp2 - entry : entry - tp2) / stop;
  if (r1 < 2) return `TP1 ${r1.toFixed(2)}R < 2R`;
  if (r2 < 3) return `TP2 ${r2.toFixed(2)}R < 3R`;
  if (direzione === "BUY" && !(sl < entry && entry < tp1 && tp1 <= tp2)) return "ordine BUY sl<entry<tp1≤tp2 non rispettato";
  if (direzione === "SELL" && !(sl > entry && entry > tp1 && tp1 >= tp2)) return "ordine SELL sl>entry>tp1≥tp2 non rispettato";
  return null;
}

export async function ricercaIngresso(mapRow: SettMapRow, now = new Date()): Promise<{
  opened: boolean;
  motivo: string;
}> {
  const week = weekStartIso(now);
  const mappa: MappaSettimana = mapRow.mappa;
  if (mappa.direzione === "NEUTRALE") {
    await insertLog("NO_TRADE", { motivo: "mappa NEUTRALE", week_start: week });
    return { opened: false, motivo: "mappa NEUTRALE" };
  }
  if (isFridayAfterUtc(now, 12, 0)) {
    await insertLog("NO_TRADE", { motivo: "venerdì dopo 12:00 UTC", week_start: week });
    return { opened: false, motivo: "venerdì dopo 12:00 UTC" };
  }
  const inFinestra = (mappa.orariDaEvitare ?? []).some((f) => insideWindow(now, f.daIso, f.aIso));
  if (inFinestra) {
    await insertLog("NO_TRADE", { motivo: "orariDaEvitare", week_start: week });
    return { opened: false, motivo: "dentro orariDaEvitare" };
  }

  const prezzoQ = await getPrezzoXau();
  if (!prezzoQ) {
    await insertLog("NO_TRADE", { motivo: "prezzo XAU N/D", week_start: week });
    return { opened: false, motivo: "prezzo N/D" };
  }
  const zona = mappa.direzione === "BUY" ? mappa.zonaBuy : mappa.zonaSell;
  if (!inZona(prezzoQ.price, zona)) {
    await insertLog("CHECK", {
      motivo: "prezzo fuori zona",
      prezzo: prezzoQ.price,
      zona,
      direzione: mappa.direzione,
    });
    return { opened: false, motivo: "prezzo fuori zona" };
  }

  const [h1, m15] = await Promise.all([getCandeleChiuse("1h", 40), getCandeleChiuse("15min", 20)]);
  const atrH1 = computeATR(
    h1.map((c) => ({
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
      datetime: c.datetime,
    })),
    14
  );
  const setup = sweepEDisplacement(h1, mappa.direzione, atrH1);
  if (!setup.ok) {
    await insertLog("CHECK", { motivo: setup.motivo, atrH1, direzione: mappa.direzione });
    return { opened: false, motivo: setup.motivo };
  }

  let raw: unknown;
  try {
    raw = await callOpenAiJson(ENTRY_PROMPT, {
      modello: openaiModel(),
      prezzo: prezzoQ.price,
      mappa,
      atrH1: atrH1 ?? "N/D",
      setup: setup.motivo,
      h1: compactCandles(h1, 10),
      m15: compactCandles(m15, 10),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await insertLog("NO_TRADE", { motivo: `AI ingresso: ${msg}` });
    return { opened: false, motivo: "AI ingresso fallita" };
  }

  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dirRaw = String(o.direzione ?? "").toUpperCase();
  if (dirRaw !== "BUY" && dirRaw !== "SELL") {
    await insertLog("NO_TRADE", { motivo: String(o.spiegazione ?? "AI NO_TRADE"), raw: o });
    return { opened: false, motivo: String(o.spiegazione ?? "AI NO_TRADE") };
  }
  if (dirRaw !== mappa.direzione) {
    await insertLog("NO_TRADE", { motivo: `direzione AI ${dirRaw} ≠ mappa ${mappa.direzione}` });
    return { opened: false, motivo: "direzione diversa dalla mappa" };
  }

  const entry = Number(o.entry);
  const sl = Number(o.sl);
  const tp1 = Number(o.tp1);
  const tp2 = Number(o.tp2);
  const fail = validaLivelli(dirRaw, entry, sl, tp1, tp2, prezzoQ.price);
  if (fail) {
    await insertLog("NO_TRADE", { motivo: fail, entry, sl, tp1, tp2, prezzo: prezzoQ.price });
    return { opened: false, motivo: fail };
  }

  const risk = rischioPrezzo(entry, sl);
  const rr = Number(((dirRaw === "BUY" ? tp2 - entry : entry - tp2) / risk).toFixed(2));
  const trade = await insertTrade({
    week_start: week,
    map_id: mapRow.id,
    direzione: dirRaw,
    entry,
    sl,
    tp1,
    tp2,
    rr,
    confidence: Number.isFinite(Number(o.confidence)) ? Number(o.confidence) : null,
    spiegazione: String(o.spiegazione ?? setup.motivo).slice(0, 800),
    giorno_ingresso: weekdayUtcName(now),
  });

  await insertLog("SEGNALE", {
    trade_id: trade.id,
    direzione: dirRaw,
    entry,
    sl,
    tp1,
    tp2,
    rr,
    setup: setup.motivo,
  });

  sendPushToAll({
    title: "Trade della settimana",
    body: `${dirRaw} entry ${entry.toFixed(2)} SL ${sl.toFixed(2)} TP1 ${tp1.toFixed(2)} TP2 ${tp2.toFixed(2)}`,
    url: "/",
    tag: "sett-segnale",
  }).catch((err) => console.error("[settimana] push segnale:", err));

  return { opened: true, motivo: `aperto ${trade.id}` };
}
