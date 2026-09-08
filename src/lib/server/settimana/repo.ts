import pg from "pg";
import type {
  EsitoTrade,
  MappaSettimana,
  SettMapRow,
  SettResultRow,
  SettTradeRow,
  TipoLog,
} from "./types";
import { LOCK_MS } from "./types";

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non impostata");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapTrade(row: Record<string, unknown>): SettTradeRow {
  return {
    id: String(row.id),
    week_start: String(row.week_start).slice(0, 10),
    map_id: row.map_id ? String(row.map_id) : null,
    direzione: row.direzione === "SELL" ? "SELL" : "BUY",
    entry: num(row.entry) ?? 0,
    sl: num(row.sl) ?? 0,
    tp1: num(row.tp1) ?? 0,
    tp2: num(row.tp2) ?? 0,
    rr: num(row.rr),
    confidence: num(row.confidence),
    spiegazione: row.spiegazione != null ? String(row.spiegazione) : null,
    aperto_il: String(row.aperto_il),
    chiuso_il: row.chiuso_il ? String(row.chiuso_il) : null,
    esito: (row.esito as EsitoTrade) ?? null,
    r_finale: num(row.r_finale),
    pnl_usd: num(row.pnl_usd),
    mfe_usd: num(row.mfe_usd),
    mae_usd: num(row.mae_usd),
    giorni_in_trade: num(row.giorni_in_trade),
    giorno_ingresso: row.giorno_ingresso != null ? String(row.giorno_ingresso) : null,
    eseguito_live: Boolean(row.eseguito_live),
    note_live: row.note_live != null ? String(row.note_live) : null,
  };
}

export async function getSettSetting(key: string): Promise<string | null> {
  const res = await getPool().query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return res.rows[0]?.value ?? null;
}

export async function setSettSetting(key: string, value: string): Promise<void> {
  await getPool().query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

export async function tryAcquireLock(): Promise<boolean> {
  const raw = await getSettSetting("sett_lock");
  const now = Date.now();
  if (raw) {
    const ts = Number(raw);
    if (Number.isFinite(ts) && now - ts < LOCK_MS) return false;
  }
  await setSettSetting("sett_lock", String(now));
  return true;
}

export async function releaseLock(): Promise<void> {
  await setSettSetting("sett_lock", "0");
}

export async function markDone(): Promise<void> {
  await setSettSetting("sett_last_done_at", new Date().toISOString());
}

export async function markError(msg: string): Promise<void> {
  await setSettSetting("sett_last_error", msg.slice(0, 2000));
}

export async function insertLog(tipo: TipoLog, dettaglio: unknown): Promise<void> {
  await getPool().query(`INSERT INTO sett_log (tipo, dettaglio) VALUES ($1, $2)`, [
    tipo,
    JSON.stringify(dettaglio ?? {}),
  ]);
}

export async function getMapForWeek(weekStart: string): Promise<SettMapRow | null> {
  const res = await getPool().query(
    `SELECT id, week_start, mappa, rigenerata, created_at
       FROM sett_maps
      WHERE week_start = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [weekStart]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    week_start: String(row.week_start).slice(0, 10),
    mappa: row.mappa,
    rigenerata: Boolean(row.rigenerata),
    created_at: row.created_at,
  };
}

export async function insertMap(
  weekStart: string,
  mappa: MappaSettimana,
  rigenerata: boolean
): Promise<SettMapRow> {
  const res = await getPool().query(
    `INSERT INTO sett_maps (week_start, mappa, rigenerata)
     VALUES ($1, $2, $3)
     RETURNING id, week_start, mappa, rigenerata, created_at`,
    [weekStart, JSON.stringify(mappa), rigenerata]
  );
  const row = res.rows[0];
  return {
    id: row.id,
    week_start: String(row.week_start).slice(0, 10),
    mappa: row.mappa,
    rigenerata: Boolean(row.rigenerata),
    created_at: row.created_at,
  };
}

export async function getOpenTrade(weekStart?: string): Promise<SettTradeRow | null> {
  const res = weekStart
    ? await getPool().query(
        `SELECT * FROM sett_trades WHERE week_start = $1 AND esito = 'OPEN' ORDER BY aperto_il DESC LIMIT 1`,
        [weekStart]
      )
    : await getPool().query(
        `SELECT * FROM sett_trades WHERE esito = 'OPEN' ORDER BY aperto_il DESC LIMIT 1`
      );
  return res.rows[0] ? mapTrade(res.rows[0]) : null;
}

export async function getTradeForWeek(weekStart: string): Promise<SettTradeRow | null> {
  const res = await getPool().query(
    `SELECT * FROM sett_trades WHERE week_start = $1 AND direzione IN ('BUY','SELL')
      ORDER BY aperto_il DESC LIMIT 1`,
    [weekStart]
  );
  return res.rows[0] ? mapTrade(res.rows[0]) : null;
}

export async function insertTrade(t: {
  week_start: string;
  map_id: string;
  direzione: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number | null;
  confidence: number | null;
  spiegazione: string;
  giorno_ingresso: string;
}): Promise<SettTradeRow> {
  const res = await getPool().query(
    `INSERT INTO sett_trades
      (week_start, map_id, direzione, entry, sl, tp1, tp2, rr, confidence, spiegazione, esito, giorno_ingresso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11)
     RETURNING *`,
    [
      t.week_start,
      t.map_id,
      t.direzione,
      t.entry,
      t.sl,
      t.tp1,
      t.tp2,
      t.rr,
      t.confidence,
      t.spiegazione,
      t.giorno_ingresso,
    ]
  );
  return mapTrade(res.rows[0]);
}

export async function closeTrade(
  id: string,
  patch: {
    esito: EsitoTrade;
    r_finale: number | null;
    pnl_usd: number | null;
    mfe_usd?: number | null;
    mae_usd?: number | null;
    giorni_in_trade?: number | null;
    chiuso_il?: string | null;
    nota?: string | null;
  }
): Promise<void> {
  await getPool().query(
    `UPDATE sett_trades
        SET esito = $2,
            r_finale = $3,
            pnl_usd = $4,
            mfe_usd = COALESCE($5, mfe_usd),
            mae_usd = COALESCE($6, mae_usd),
            giorni_in_trade = COALESCE($7, giorni_in_trade),
            chiuso_il = COALESCE($8::timestamptz, now()),
            spiegazione = CASE WHEN $9::text IS NULL THEN spiegazione ELSE COALESCE(spiegazione,'') || $9 END
      WHERE id = $1 AND esito = 'OPEN'`,
    [
      id,
      patch.esito,
      patch.r_finale,
      patch.pnl_usd,
      patch.mfe_usd ?? null,
      patch.mae_usd ?? null,
      patch.giorni_in_trade ?? null,
      patch.chiuso_il ?? null,
      patch.nota ?? null,
    ]
  );
}

export async function updateTradeLive(
  id: string,
  eseguitoLive: boolean,
  noteLive?: string | null
): Promise<void> {
  await getPool().query(
    `UPDATE sett_trades SET eseguito_live = $2, note_live = COALESCE($3, note_live) WHERE id = $1`,
    [id, eseguitoLive, noteLive ?? null]
  );
}

export async function updateTradeMfeMae(id: string, mfeUsd: number, maeUsd: number): Promise<void> {
  await getPool().query(`UPDATE sett_trades SET mfe_usd = $2, mae_usd = $3 WHERE id = $1`, [
    id,
    mfeUsd,
    maeUsd,
  ]);
}

export async function insertSnapshot(
  tradeId: string,
  price: number,
  pnlR: number,
  pnlUsd: number
): Promise<void> {
  await getPool().query(
    `INSERT INTO sett_snapshots (trade_id, price, pnl_r, pnl_usd) VALUES ($1,$2,$3,$4)`,
    [tradeId, price, pnlR, pnlUsd]
  );
}

export async function getLatestSnapshotPrice(tradeId: string): Promise<number | null> {
  const res = await getPool().query(
    `SELECT price FROM sett_snapshots WHERE trade_id = $1 ORDER BY ts DESC LIMIT 1`,
    [tradeId]
  );
  return num(res.rows[0]?.price);
}

export async function upsertResult(row: SettResultRow): Promise<void> {
  await getPool().query(
    `INSERT INTO sett_results
      (week_start, direzione_prevista, chiusura_weekly_reale, direzione_reale,
       mappa_corretta, zona_buy_toccata, zona_sell_toccata, trade_id, evento_dominante)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (week_start) DO UPDATE SET
       direzione_prevista = EXCLUDED.direzione_prevista,
       chiusura_weekly_reale = EXCLUDED.chiusura_weekly_reale,
       direzione_reale = EXCLUDED.direzione_reale,
       mappa_corretta = EXCLUDED.mappa_corretta,
       zona_buy_toccata = EXCLUDED.zona_buy_toccata,
       zona_sell_toccata = EXCLUDED.zona_sell_toccata,
       trade_id = EXCLUDED.trade_id,
       evento_dominante = EXCLUDED.evento_dominante`,
    [
      row.week_start,
      row.direzione_prevista,
      row.chiusura_weekly_reale,
      row.direzione_reale,
      row.mappa_corretta,
      row.zona_buy_toccata,
      row.zona_sell_toccata,
      row.trade_id,
      row.evento_dominante,
    ]
  );
}

export async function getHistory(limit = 20): Promise<{
  results: SettResultRow[];
  trades: SettTradeRow[];
  maps: SettMapRow[];
}> {
  const client = getPool();
  const [results, trades, maps] = await Promise.all([
    client.query(`SELECT * FROM sett_results ORDER BY week_start DESC LIMIT $1`, [limit]),
    client.query(`SELECT * FROM sett_trades ORDER BY week_start DESC, aperto_il DESC LIMIT $1`, [limit]),
    client.query(`SELECT * FROM sett_maps ORDER BY week_start DESC, created_at DESC LIMIT $1`, [limit]),
  ]);
  return {
    results: results.rows.map((r) => ({
      week_start: String(r.week_start).slice(0, 10),
      direzione_prevista: r.direzione_prevista,
      chiusura_weekly_reale: num(r.chiusura_weekly_reale),
      direzione_reale: r.direzione_reale,
      mappa_corretta: r.mappa_corretta,
      zona_buy_toccata: r.zona_buy_toccata,
      zona_sell_toccata: r.zona_sell_toccata,
      trade_id: r.trade_id,
      evento_dominante: r.evento_dominante,
    })),
    trades: trades.rows.map(mapTrade),
    maps: maps.rows.map((r) => ({
      id: r.id,
      week_start: String(r.week_start).slice(0, 10),
      mappa: r.mappa,
      rigenerata: Boolean(r.rigenerata),
      created_at: r.created_at,
    })),
  };
}

export async function sumClosedPnl(): Promise<{ weekUsd: number; weekR: number; totUsd: number; totR: number }> {
  const week = (await import("./week")).weekStartIso();
  const client = getPool();
  const tot = await client.query(
    `SELECT COALESCE(SUM(pnl_usd),0) AS usd, COALESCE(SUM(r_finale),0) AS r
       FROM sett_trades WHERE esito IS NOT NULL AND esito <> 'OPEN' AND esito <> 'NO_TRADE'`
  );
  const w = await client.query(
    `SELECT COALESCE(SUM(pnl_usd),0) AS usd, COALESCE(SUM(r_finale),0) AS r
       FROM sett_trades
      WHERE week_start = $1 AND esito IS NOT NULL AND esito <> 'NO_TRADE'`,
    [week]
  );
  return {
    weekUsd: Number(w.rows[0]?.usd) || 0,
    weekR: Number(w.rows[0]?.r) || 0,
    totUsd: Number(tot.rows[0]?.usd) || 0,
    totR: Number(tot.rows[0]?.r) || 0,
  };
}

export async function getTradeById(id: string): Promise<SettTradeRow | null> {
  const res = await getPool().query(`SELECT * FROM sett_trades WHERE id = $1`, [id]);
  return res.rows[0] ? mapTrade(res.rows[0]) : null;
}

export async function getLastSnapshot(tradeId: string): Promise<{
  ts: string;
  price: number;
  pnl_r: number | null;
  pnl_usd: number | null;
} | null> {
  const res = await getPool().query(
    `SELECT ts, price, pnl_r, pnl_usd FROM sett_snapshots WHERE trade_id = $1 ORDER BY ts DESC LIMIT 1`,
    [tradeId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    ts: String(row.ts),
    price: Number(row.price),
    pnl_r: num(row.pnl_r),
    pnl_usd: num(row.pnl_usd),
  };
}
