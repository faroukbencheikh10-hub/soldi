import pg from "pg";
import type {
  AsiaRangeRow,
  AsiaTradeRow,
  DirezioneAsia,
  EsitoAsia,
  LatoSweep,
  TipoLogAsia,
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

function mapRange(row: Record<string, unknown>): AsiaRangeRow {
  return {
    giorno: String(row.giorno).slice(0, 10),
    range_high: num(row.range_high) ?? 0,
    range_low: num(row.range_low) ?? 0,
    ampiezza: num(row.ampiezza) ?? 0,
    valido: Boolean(row.valido),
    motivo: row.motivo != null ? String(row.motivo) : null,
    created_at: String(row.created_at),
  };
}

function mapTrade(row: Record<string, unknown>): AsiaTradeRow {
  return {
    id: String(row.id),
    giorno: String(row.giorno).slice(0, 10),
    direzione: row.direzione === "SELL" ? "SELL" : "BUY",
    lato_sweep: row.lato_sweep === "LOW" ? "LOW" : "HIGH",
    livello_sweep: num(row.livello_sweep) ?? 0,
    profondita_sweep_usd: num(row.profondita_sweep_usd),
    entry: num(row.entry) ?? 0,
    sl: num(row.sl) ?? 0,
    tp1: num(row.tp1) ?? 0,
    tp2: num(row.tp2) ?? 0,
    rr: num(row.rr),
    aperto_il: String(row.aperto_il),
    chiuso_il: row.chiuso_il ? String(row.chiuso_il) : null,
    esito: (row.esito as EsitoAsia) ?? null,
    r_finale: num(row.r_finale),
    pnl_usd: num(row.pnl_usd),
    mfe_usd: num(row.mfe_usd),
    mae_usd: num(row.mae_usd),
    minuti_in_trade: num(row.minuti_in_trade),
    ora_ingresso_utc: num(row.ora_ingresso_utc),
    eseguito_live: Boolean(row.eseguito_live),
    note_live: row.note_live != null ? String(row.note_live) : null,
  };
}

export async function getAsiaSetting(key: string): Promise<string | null> {
  const res = await getPool().query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return res.rows[0]?.value ?? null;
}

export async function setAsiaSetting(key: string, value: string): Promise<void> {
  await getPool().query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

export async function tryAcquireLock(): Promise<boolean> {
  const raw = await getAsiaSetting("asia_lock");
  const now = Date.now();
  if (raw) {
    const ts = Number(raw);
    if (Number.isFinite(ts) && now - ts < LOCK_MS) return false;
  }
  await setAsiaSetting("asia_lock", String(now));
  return true;
}

export async function releaseLock(): Promise<void> {
  await setAsiaSetting("asia_lock", "0");
}

export async function markDone(): Promise<void> {
  await setAsiaSetting("asia_last_done_at", new Date().toISOString());
}

export async function markError(msg: string): Promise<void> {
  await setAsiaSetting("asia_last_error", msg.slice(0, 2000));
}

export async function insertLog(tipo: TipoLogAsia, dettaglio: unknown): Promise<void> {
  await getPool().query(`INSERT INTO asia_log (tipo, dettaglio) VALUES ($1, $2)`, [
    tipo,
    JSON.stringify(dettaglio ?? {}),
  ]);
}

export async function getRange(giorno: string): Promise<AsiaRangeRow | null> {
  const res = await getPool().query(`SELECT * FROM asia_ranges WHERE giorno = $1`, [giorno]);
  return res.rows[0] ? mapRange(res.rows[0]) : null;
}

export async function upsertRange(row: {
  giorno: string;
  range_high: number;
  range_low: number;
  ampiezza: number;
  valido: boolean;
  motivo: string | null;
}): Promise<AsiaRangeRow> {
  const res = await getPool().query(
    `INSERT INTO asia_ranges (giorno, range_high, range_low, ampiezza, valido, motivo)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (giorno) DO UPDATE SET
       range_high = EXCLUDED.range_high,
       range_low = EXCLUDED.range_low,
       ampiezza = EXCLUDED.ampiezza,
       valido = EXCLUDED.valido,
       motivo = EXCLUDED.motivo
     RETURNING *`,
    [row.giorno, row.range_high, row.range_low, row.ampiezza, row.valido, row.motivo]
  );
  return mapRange(res.rows[0]);
}

export async function getOpenTrade(giorno?: string): Promise<AsiaTradeRow | null> {
  const res = giorno
    ? await getPool().query(
        `SELECT * FROM asia_trades WHERE giorno = $1 AND esito = 'OPEN' ORDER BY aperto_il DESC LIMIT 1`,
        [giorno]
      )
    : await getPool().query(
        `SELECT * FROM asia_trades WHERE esito = 'OPEN' ORDER BY aperto_il DESC LIMIT 1`
      );
  return res.rows[0] ? mapTrade(res.rows[0]) : null;
}

export async function getTradesDelGiorno(giorno: string): Promise<AsiaTradeRow[]> {
  const res = await getPool().query(
    `SELECT * FROM asia_trades WHERE giorno = $1 ORDER BY aperto_il ASC`,
    [giorno]
  );
  return res.rows.map(mapTrade);
}

export async function insertTrade(t: {
  giorno: string;
  direzione: DirezioneAsia;
  lato_sweep: LatoSweep;
  livello_sweep: number;
  profondita_sweep_usd: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number | null;
  ora_ingresso_utc: number;
}): Promise<AsiaTradeRow> {
  const res = await getPool().query(
    `INSERT INTO asia_trades
      (giorno, direzione, lato_sweep, livello_sweep, profondita_sweep_usd,
       entry, sl, tp1, tp2, rr, esito, ora_ingresso_utc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11)
     RETURNING *`,
    [
      t.giorno,
      t.direzione,
      t.lato_sweep,
      t.livello_sweep,
      t.profondita_sweep_usd,
      t.entry,
      t.sl,
      t.tp1,
      t.tp2,
      t.rr,
      t.ora_ingresso_utc,
    ]
  );
  return mapTrade(res.rows[0]);
}

export async function closeTrade(
  id: string,
  patch: {
    esito: EsitoAsia;
    r_finale: number | null;
    pnl_usd: number | null;
    mfe_usd?: number | null;
    mae_usd?: number | null;
    minuti_in_trade?: number | null;
    chiuso_il?: string | null;
    nota?: string | null;
  }
): Promise<void> {
  await getPool().query(
    `UPDATE asia_trades
        SET esito = $2,
            r_finale = $3,
            pnl_usd = $4,
            mfe_usd = COALESCE($5, mfe_usd),
            mae_usd = COALESCE($6, mae_usd),
            minuti_in_trade = COALESCE($7, minuti_in_trade),
            chiuso_il = COALESCE($8::timestamptz, now()),
            note_live = CASE
              WHEN $9::text IS NULL THEN note_live
              ELSE COALESCE(note_live || ' | ', '') || $9
            END
      WHERE id = $1 AND esito = 'OPEN'`,
    [
      id,
      patch.esito,
      patch.r_finale,
      patch.pnl_usd,
      patch.mfe_usd ?? null,
      patch.mae_usd ?? null,
      patch.minuti_in_trade ?? null,
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
    `UPDATE asia_trades SET eseguito_live = $2, note_live = COALESCE($3, note_live) WHERE id = $1`,
    [id, eseguitoLive, noteLive ?? null]
  );
}

export async function updateTradeMfeMae(id: string, mfeUsd: number, maeUsd: number): Promise<void> {
  await getPool().query(`UPDATE asia_trades SET mfe_usd = $2, mae_usd = $3 WHERE id = $1`, [
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
    `INSERT INTO asia_snapshots (trade_id, price, pnl_r, pnl_usd) VALUES ($1,$2,$3,$4)`,
    [tradeId, price, pnlR, pnlUsd]
  );
}

export async function getLastSnapshot(tradeId: string): Promise<{
  ts: string;
  price: number;
  pnl_r: number | null;
  pnl_usd: number | null;
} | null> {
  const res = await getPool().query(
    `SELECT ts, price, pnl_r, pnl_usd FROM asia_snapshots WHERE trade_id = $1 ORDER BY ts DESC LIMIT 1`,
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

export async function getTradeById(id: string): Promise<AsiaTradeRow | null> {
  const res = await getPool().query(`SELECT * FROM asia_trades WHERE id = $1`, [id]);
  return res.rows[0] ? mapTrade(res.rows[0]) : null;
}

export async function getLastNoTrade(giorno?: string): Promise<{ ts: string; motivo: string } | null> {
  const res = giorno
    ? await getPool().query(
        `SELECT ts, dettaglio FROM asia_log
          WHERE tipo = 'NO_TRADE' AND dettaglio->>'giorno' = $1
          ORDER BY ts DESC LIMIT 1`,
        [giorno]
      )
    : await getPool().query(
        `SELECT ts, dettaglio FROM asia_log WHERE tipo = 'NO_TRADE' ORDER BY ts DESC LIMIT 1`
      );
  const row = res.rows[0];
  if (!row) return null;
  const d = row.dettaglio && typeof row.dettaglio === "object" ? row.dettaglio : {};
  return {
    ts: String(row.ts),
    motivo: String((d as { motivo?: string }).motivo ?? "N/D"),
  };
}

export async function sumClosedPnl(giorno: string): Promise<{
  sessioneUsd: number;
  sessioneR: number;
  totUsd: number;
  totR: number;
}> {
  const client = getPool();
  const tot = await client.query(
    `SELECT COALESCE(SUM(pnl_usd),0) AS usd, COALESCE(SUM(r_finale),0) AS r
       FROM asia_trades WHERE esito IS NOT NULL AND esito <> 'OPEN'`
  );
  const s = await client.query(
    `SELECT COALESCE(SUM(pnl_usd),0) AS usd, COALESCE(SUM(r_finale),0) AS r
       FROM asia_trades WHERE giorno = $1 AND esito IS NOT NULL AND esito <> 'OPEN'`,
    [giorno]
  );
  return {
    sessioneUsd: Number(s.rows[0]?.usd) || 0,
    sessioneR: Number(s.rows[0]?.r) || 0,
    totUsd: Number(tot.rows[0]?.usd) || 0,
    totR: Number(tot.rows[0]?.r) || 0,
  };
}

export async function getHistoryRows(limit = 40): Promise<{
  ranges: AsiaRangeRow[];
  trades: AsiaTradeRow[];
}> {
  const client = getPool();
  const [ranges, trades] = await Promise.all([
    client.query(`SELECT * FROM asia_ranges ORDER BY giorno DESC LIMIT $1`, [limit]),
    client.query(`SELECT * FROM asia_trades ORDER BY giorno DESC, aperto_il ASC LIMIT $1`, [
      limit * 2,
    ]),
  ]);
  return {
    ranges: ranges.rows.map(mapRange),
    trades: trades.rows.map(mapTrade),
  };
}

export async function getContoAsiaStats(): Promise<{
  wins: number;
  losses: number;
  parziali: number;
  sessionClose: number;
  giorniConTrade: number;
  giorniConRange: number;
  perOra: { ora: number; n: number; r: number; usd: number }[];
}> {
  const client = getPool();
  const [t, r, ore] = await Promise.all([
    client.query(`
      SELECT
        COUNT(*) FILTER (WHERE esito = 'WIN') AS wins,
        COUNT(*) FILTER (WHERE esito = 'LOSS') AS losses,
        COUNT(*) FILTER (WHERE esito = 'WIN_PARZIALE') AS parziali,
        COUNT(*) FILTER (WHERE esito = 'SESSION_CLOSE') AS session_close,
        COUNT(DISTINCT giorno) FILTER (WHERE esito IS NOT NULL) AS giorni_con_trade
      FROM asia_trades
    `),
    client.query(`SELECT COUNT(*) AS n FROM asia_ranges`),
    client.query(`
      SELECT ora_ingresso_utc AS ora,
             COUNT(*) AS n,
             COALESCE(SUM(r_finale),0) AS r,
             COALESCE(SUM(pnl_usd),0) AS usd
        FROM asia_trades
       WHERE ora_ingresso_utc BETWEEN 2 AND 6
         AND esito IS NOT NULL AND esito <> 'OPEN'
       GROUP BY ora_ingresso_utc
       ORDER BY ora_ingresso_utc
    `),
  ]);
  const row = t.rows[0] ?? {};
  return {
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    parziali: Number(row.parziali) || 0,
    sessionClose: Number(row.session_close) || 0,
    giorniConTrade: Number(row.giorni_con_trade) || 0,
    giorniConRange: Number(r.rows[0]?.n) || 0,
    perOra: ore.rows.map((x) => ({
      ora: Number(x.ora) || 0,
      n: Number(x.n) || 0,
      r: Number(x.r) || 0,
      usd: Number(x.usd) || 0,
    })),
  };
}
