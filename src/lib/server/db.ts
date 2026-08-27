import pg from "pg";

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

export async function ensureSchema() {
  const client = getPool();
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      direction TEXT NOT NULL CHECK (direction IN ('BUY','SELL','NO_TRADE')),
      entry NUMERIC NOT NULL,
      stop_loss NUMERIC NOT NULL,
      tp1 NUMERIC NOT NULL,
      tp2 NUMERIC NOT NULL,
      risk_reward NUMERIC NOT NULL,
      confidence NUMERIC NOT NULL,
      reasoning TEXT NOT NULL,
      market_snapshot JSONB,
      outcome TEXT CHECK (outcome IN ('WIN','LOSS','OPEN','BREAKEVEN')),
      result_r NUMERIC,
      closed_at TIMESTAMPTZ,
      is_demo BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at DESC);
    -- Puramente informativo (canale normale): dove spostare lo stop SE TP1
    -- viene raggiunto e il trade resta aperto verso TP2 (es. breakeven).
    -- ADD COLUMN IF NOT EXISTS perche' la tabella esiste gia' in produzione
    -- con dati: CREATE TABLE IF NOT EXISTS da solo non aggiunge colonne a
    -- una tabella che esiste gia'. Non influenza chiusura trade/R:R/validazione.
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS stop_loss_tp2 NUMERIC;

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      xauusd NUMERIC,
      xauusd_change_pct NUMERIC,
      dxy NUMERIC,
      dxy_change_pct NUMERIC,
      us10y NUMERIC,
      us10y_change_pct NUMERIC,
      raw JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_market_snapshots_created_at ON market_snapshots (created_at DESC);

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      news JSONB,
      calendar JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_context_snapshots_created_at ON context_snapshots (created_at DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      endpoint TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals_5m (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      direction TEXT NOT NULL CHECK (direction IN ('BUY','SELL','NO_TRADE')),
      entry NUMERIC NOT NULL,
      stop_loss NUMERIC NOT NULL,
      tp1 NUMERIC NOT NULL,
      tp2 NUMERIC NOT NULL,
      risk_reward NUMERIC NOT NULL,
      confidence NUMERIC NOT NULL,
      reasoning TEXT NOT NULL,
      market_snapshot JSONB,
      outcome TEXT CHECK (outcome IN ('WIN','LOSS','OPEN','BREAKEVEN')),
      result_r NUMERIC,
      closed_at TIMESTAMPTZ,
      is_demo BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_signals_5m_created_at ON signals_5m (created_at DESC);

    CREATE TABLE IF NOT EXISTS setup_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tipo TEXT NOT NULL CHECK (tipo IN ('sweep','displacement','bos','choch')),
      timeframe TEXT NOT NULL CHECK (timeframe IN ('M5','M30')),
      direzione TEXT NOT NULL CHECK (direzione IN ('rialzista','ribassista')),
      livello NUMERIC NOT NULL,
      candela_ts TIMESTAMPTZ NOT NULL,
      rilevato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
      stato TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (stato IN ('ACTIVE','INVALIDATED','EXPIRED')),
      chiuso_il TIMESTAMPTZ,
      motivo_chiusura TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_events_dedup
      ON setup_events (tipo, timeframe, direzione, candela_ts);
    CREATE INDEX IF NOT EXISTS idx_setup_events_stato ON setup_events (stato, rilevato_il DESC);

    ALTER TABLE setup_events DROP CONSTRAINT IF EXISTS setup_events_timeframe_check;
    ALTER TABLE setup_events ADD CONSTRAINT setup_events_timeframe_check
      CHECK (timeframe IN ('M5','M30','H1'));

    CREATE TABLE IF NOT EXISTS market_context (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
      prezzo NUMERIC NOT NULL,
      firma TEXT NOT NULL,
      stato JSONB NOT NULL,
      transizione JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_market_context_creato_il ON market_context (creato_il DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Memoria persistente delle candele CHIUSE (H1/M30/M5). Tabella dedicata,
    -- separata da market_snapshots.raw: qui dentro vanno solo le candele,
    -- leggibili singolarmente, non un blob JSON di tutto lo snapshot.
    CREATE TABLE IF NOT EXISTS candle_memory (
      timeframe TEXT NOT NULL CHECK (timeframe IN ('H1','M30','M5')),
      datetime TIMESTAMPTZ NOT NULL,
      open NUMERIC NOT NULL,
      high NUMERIC NOT NULL,
      low NUMERIC NOT NULL,
      close NUMERIC NOT NULL,
      inserita_il TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (timeframe, datetime)
    );
    CREATE INDEX IF NOT EXISTS idx_candle_memory_timeframe_datetime
      ON candle_memory (timeframe, datetime DESC);
  `);
}

export async function savePushSubscription(endpoint: string, subscription: unknown) {
  const client = getPool();
  await client.query(
    `INSERT INTO push_subscriptions (endpoint, subscription)
     VALUES ($1, $2)
     ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription`,
    [endpoint, JSON.stringify(subscription)]
  );
}

export async function deletePushSubscription(endpoint: string) {
  const client = getPool();
  await client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function getAllPushSubscriptions() {
  const client = getPool();
  const res = await client.query(`SELECT endpoint, subscription FROM push_subscriptions`);
  return res.rows as { endpoint: string; subscription: any }[];
}

export async function insertSignal(signal: {
  direction: string;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  stopLossTp2?: number | null;
  riskReward: number | null;
  confidence: number;
  reasoning: string;
  marketSnapshot?: unknown;
}) {
  const client = getPool();
  const entry = signal.entry ?? 0;
  const stopLoss = signal.stopLoss ?? 0;
  const tp1 = signal.tp1 ?? 0;
  const tp2 = signal.tp2 ?? 0;
  const stopLossTp2 = signal.stopLossTp2 ?? null;
  const riskReward = signal.riskReward ?? 0;
  const confidence = signal.confidence ?? 0;
  const reasoning = signal.reasoning ?? "Risposta AI incompleta: campo mancante.";
  const res = await client.query(
    `INSERT INTO signals
      (direction, entry, stop_loss, tp1, tp2, stop_loss_tp2, risk_reward, confidence, reasoning, market_snapshot, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
     RETURNING id, created_at`,
    [
      signal.direction,
      entry,
      stopLoss,
      tp1,
      tp2,
      stopLossTp2,
      riskReward,
      confidence,
      reasoning,
      JSON.stringify(signal.marketSnapshot ?? {}),
    ]
  );
  return res.rows[0];
}

export async function insertMarketSnapshot(s: {
  xauusd: number;
  xauusdChangePct: number;
  dxy: number | null;
  dxyChangePct: number | null;
  us10y: number | null;
  us10yChangePct: number | null;
  [k: string]: unknown;
}) {
  const client = getPool();
  await client.query(
    `INSERT INTO market_snapshots (xauusd, xauusd_change_pct, dxy, dxy_change_pct, us10y, us10y_change_pct, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [s.xauusd, s.xauusdChangePct, s.dxy, s.dxyChangePct, s.us10y, s.us10yChangePct, JSON.stringify(s)]
  );
}

export async function insertContextSnapshot(news: unknown, calendar: unknown) {
  const client = getPool();
  await client.query(`INSERT INTO context_snapshots (news, calendar) VALUES ($1,$2)`, [
    JSON.stringify(news ?? []),
    JSON.stringify(calendar ?? []),
  ]);
}

export async function getLatestMarketSnapshot() {
  const client = getPool();
  // Niente SELECT *: la colonna raw contiene l'intero snapshot con tutte le
  // candele (decine di KB). Estraiamo solo il campo che serve davvero.
  const res = await client.query(
    `SELECT id, created_at, xauusd, xauusd_change_pct, dxy, dxy_change_pct, us10y, us10y_change_pct,
            raw->>'xauusdQuotedAt' AS xauusd_quoted_at
     FROM market_snapshots ORDER BY created_at DESC LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) return null;
  // Ricostruiamo la forma attesa dal resto dell'app senza trascinarci le candele.
  return { ...row, raw: { xauusdQuotedAt: row.xauusd_quoted_at ?? null } };
}

export async function getLatestContextSnapshot() {
  const client = getPool();
  const res = await client.query(`SELECT * FROM context_snapshots ORDER BY created_at DESC LIMIT 1`);
  return res.rows[0] ?? null;
}

export async function getSignalHistory(limit = 20) {
  const client = getPool();
  const res = await client.query(
    `SELECT id, created_at, direction, entry, stop_loss, tp1, tp2, stop_loss_tp2, risk_reward,
            confidence, reasoning, outcome, result_r, closed_at
     FROM signals WHERE is_demo = false ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// Solo per la diagnostica /api/debug/confronto: rilegge lo snapshot di
// mercato salvato con ogni segnale, per poter rigiocare la stessa decisione
// con il payload nuovo. Nessun altro punto dell'app deve usarla.
export async function getSegnaliConSnapshot(limit = 3) {
  const client = getPool();
  const res = await client.query(
    `SELECT id, created_at, direction, market_snapshot
       FROM signals
      WHERE market_snapshot IS NOT NULL
        AND direction IN ('BUY', 'SELL', 'NO_TRADE')
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return res.rows as Array<{
    id: string;
    created_at: string;
    direction: string;
    market_snapshot: Record<string, unknown>;
  }>;
}

export async function getLatestSignal() {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

export async function closeSignal(
  id: string,
  outcome: "WIN" | "LOSS" | "BREAKEVEN",
  resultR: number,
  note?: string
) {
  const client = getPool();
  if (note) {
    await client.query(
      `UPDATE signals SET outcome = $2, result_r = $3, closed_at = now(), reasoning = reasoning || $4 WHERE id = $1`,
      [id, outcome, resultR, note]
    );
  } else {
    await client.query(
      `UPDATE signals SET outcome = $2, result_r = $3, closed_at = now() WHERE id = $1`,
      [id, outcome, resultR]
    );
  }
}

export async function getStats() {
  const client = getPool();
  const res = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_demo = false AND direction <> 'NO_TRADE') AS total,
      COUNT(*) FILTER (WHERE is_demo = false AND outcome = 'WIN') AS wins,
      COUNT(*) FILTER (WHERE is_demo = false AND outcome IN ('WIN','LOSS')) AS decided,
      AVG(risk_reward) FILTER (WHERE is_demo = false AND direction <> 'NO_TRADE' AND risk_reward > 0) AS avg_rr
    FROM signals
  `);
  return res.rows[0];
}

export async function insertSignal5m(signal: {
  direction: string;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskReward: number | null;
  confidence: number;
  reasoning: string;
  marketSnapshot?: unknown;
}) {
  const client = getPool();
  const entry = signal.entry ?? 0;
  const stopLoss = signal.stopLoss ?? 0;
  const tp1 = signal.tp1 ?? 0;
  const tp2 = signal.tp2 ?? 0;
  const riskReward = signal.riskReward ?? 0;
  const confidence = signal.confidence ?? 0;
  const reasoning = signal.reasoning ?? "Risposta AI incompleta: campo mancante.";
  const res = await client.query(
    `INSERT INTO signals_5m
      (direction, entry, stop_loss, tp1, tp2, risk_reward, confidence, reasoning, market_snapshot, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
     RETURNING id, created_at`,
    [
      signal.direction,
      entry,
      stopLoss,
      tp1,
      tp2,
      riskReward,
      confidence,
      reasoning,
      JSON.stringify(signal.marketSnapshot ?? {}),
    ]
  );
  return res.rows[0];
}

export async function getSignalHistory5m(limit = 50) {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals_5m WHERE is_demo = false AND direction != 'NO_TRADE' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function getLatestSignal5m() {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals_5m WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

export async function closeSignal5m(
  id: string,
  outcome: "WIN" | "LOSS" | "BREAKEVEN",
  resultR: number,
  note?: string
) {
  const client = getPool();
  if (note) {
    await client.query(
      `UPDATE signals_5m SET outcome = $2, result_r = $3, closed_at = now(), reasoning = reasoning || $4 WHERE id = $1`,
      [id, outcome, resultR, note]
    );
  } else {
    await client.query(
      `UPDATE signals_5m SET outcome = $2, result_r = $3, closed_at = now() WHERE id = $1`,
      [id, outcome, resultR]
    );
  }
}

export async function getStats5m() {
  const client = getPool();
  const res = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_demo = false AND direction != 'NO_TRADE') AS total,
      COUNT(*) FILTER (WHERE is_demo = false AND outcome = 'WIN') AS wins,
      COUNT(*) FILTER (WHERE is_demo = false AND outcome IN ('WIN','LOSS')) AS decided,
      AVG(risk_reward) FILTER (WHERE is_demo = false AND direction <> 'NO_TRADE' AND risk_reward > 0) AS avg_rr
    FROM signals_5m
  `);
  return res.rows[0];
}

export async function getSetting(key: string): Promise<string | null> {
  const client = getPool();
  const res = await client.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return res.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const client = getPool();
  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

export async function isAiPaused(): Promise<boolean> {
  const value = await getSetting("ai_paused");
  if (value !== "true") return false;

  const pausedAtRaw = await getSetting("ai_paused_at");
  const pausedAt = pausedAtRaw ? new Date(pausedAtRaw).getTime() : null;
  const PAUSA_MAX_ORE = 2;
  if (pausedAt !== null && Date.now() - pausedAt > PAUSA_MAX_ORE * 60 * 60 * 1000) {
    await setAiPaused(false);
    return false;
  }

  return true;
}

export async function setAiPaused(paused: boolean) {
  await setSetting("ai_paused", paused ? "true" : "false");
  if (paused) {
    await setSetting("ai_paused_at", new Date().toISOString());
  }
}

// Stato minimo per /api/ticker: prezzo, variazione, orario e l'ultimo segnale
// di ogni canale. Poche decine di byte invece di centinaia di KB.
export async function getTickerState() {
  const client = getPool();
  const [snap, ultimo, ultimo5m] = await Promise.all([
    client.query(
      `SELECT xauusd, xauusd_change_pct, created_at, raw->>'xauusdQuotedAt' AS xauusd_quoted_at
       FROM market_snapshots ORDER BY created_at DESC LIMIT 1`
    ),
    client.query(
      `SELECT id, direction, entry, confidence FROM signals
       WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
    ),
    client.query(
      `SELECT id, direction, entry, confidence FROM signals_5m
       WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
    ),
  ]);
  const s = snap.rows[0] ?? null;
  return {
    prezzo: s?.xauusd !== undefined && s?.xauusd !== null ? Number(s.xauusd) : null,
    variazionePct:
      s?.xauusd_change_pct !== undefined && s?.xauusd_change_pct !== null
        ? Number(s.xauusd_change_pct)
        : null,
    snapshotCreatoIl: s?.created_at ?? null,
    quotatoIl: s?.xauusd_quoted_at ? Number(s.xauusd_quoted_at) : null,
    ultimoSegnale: ultimo.rows[0] ?? null,
    ultimoSegnale5m: ultimo5m.rows[0] ?? null,
  };
}

// --- memoria degli eventi di setup ---------------------------------------

export async function inserisciEventiSetup(
  eventi: { tipo: string; timeframe: string; direzione: string; livello: number; candelaTs: string }[]
): Promise<number> {
  if (eventi.length === 0) return 0;
  const client = getPool();
  let nuovi = 0;
  for (const e of eventi) {
    const res = await client.query(
      `INSERT INTO setup_events (tipo, timeframe, direzione, livello, candela_ts)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tipo, timeframe, direzione, candela_ts) DO NOTHING
       RETURNING id`,
      [e.tipo, e.timeframe, e.direzione, e.livello, e.candelaTs]
    );
    if (res.rowCount && res.rowCount > 0) nuovi += 1;
  }
  return nuovi;
}

export async function getEventiSetupAttivi() {
  const client = getPool();
  const res = await client.query(
    `SELECT id, tipo, timeframe, direzione, livello, candela_ts, rilevato_il
     FROM setup_events WHERE stato = 'ACTIVE' ORDER BY rilevato_il DESC LIMIT 40`
  );
  return res.rows;
}

export async function chiudiEventoSetup(id: string, stato: "INVALIDATED" | "EXPIRED", motivo: string) {
  const client = getPool();
  await client.query(
    `UPDATE setup_events SET stato = $2, chiuso_il = now(), motivo_chiusura = $3 WHERE id = $1`,
    [id, stato, motivo]
  );
}

// --- registro del contesto (audit, MAI fonte di verita') -------------------

export async function inserisciContesto(
  prezzo: number,
  firma: string,
  stato: unknown,
  transizione: unknown
) {
  const client = getPool();
  const res = await client.query(
    `INSERT INTO market_context (prezzo, firma, stato, transizione)
     VALUES ($1,$2,$3,$4) RETURNING id, creato_il`,
    [prezzo, firma, JSON.stringify(stato), JSON.stringify(transizione ?? null)]
  );
  return res.rows[0];
}

export async function getUltimoContesto() {
  const client = getPool();
  const res = await client.query(
    `SELECT id, creato_il, prezzo, firma, stato, transizione
     FROM market_context ORDER BY creato_il DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// MEMORIA CANDELE (H1 / M30 / M5)
//
// Solo infrastruttura: salva e rende rileggibili le candele CHIUSE dei tre
// timeframe. Nessuna funzione qui dentro viene letta dalla strategia o
// dall'AI -- e' compito di chi la richiama decidere se e come usarla in
// futuro. Deliberatamente separata da market_snapshots.raw (che resta un
// blob JSON dell'intero snapshot, mai riletto candela per candela).
// ---------------------------------------------------------------------------

export type CandleMemoryTimeframe = "H1" | "M30" | "M5";

export const CANDLE_MEMORY_RETENTION_MS: Record<CandleMemoryTimeframe, number> = {
  H1: 72 * 60 * 60 * 1000,
  M30: 48 * 60 * 60 * 1000,
  M5: 12 * 60 * 60 * 1000,
};

export interface CandelaMemoria {
  timeframe: CandleMemoryTimeframe;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Inserisce solo candele CHIUSE (spetta al chiamante escludere quella ancora
// in formazione). La chiave (timeframe, datetime) fa da deduplicazione:
// una candela gia' presente viene ignorata silenziosamente, mai aggiornata.
// Ritorna quante candele erano davvero nuove.
export async function salvaCandeleMemoria(
  timeframe: CandleMemoryTimeframe,
  candele: { datetime: string; open: number; high: number; low: number; close: number }[]
): Promise<number> {
  if (!Array.isArray(candele) || candele.length === 0) return 0;
  const client = getPool();
  let nuove = 0;
  for (const c of candele) {
    const res = await client.query(
      `INSERT INTO candle_memory (timeframe, datetime, open, high, low, close)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (timeframe, datetime) DO NOTHING
       RETURNING timeframe`,
      [timeframe, c.datetime, c.open, c.high, c.low, c.close]
    );
    if (res.rowCount && res.rowCount > 0) nuove += 1;
  }
  return nuove;
}

// Elimina le candele piu' vecchie della retention del proprio timeframe.
// Senza argomento pulisce tutti e tre i timeframe con la propria soglia.
export async function pulisciCandeleMemoria(timeframe?: CandleMemoryTimeframe): Promise<void> {
  const client = getPool();
  const timeframes: CandleMemoryTimeframe[] = timeframe ? [timeframe] : ["H1", "M30", "M5"];
  for (const tf of timeframes) {
    const soglia = new Date(Date.now() - CANDLE_MEMORY_RETENTION_MS[tf]).toISOString();
    await client.query(`DELETE FROM candle_memory WHERE timeframe = $1 AND datetime < $2`, [tf, soglia]);
  }
}

// Legge la memoria di un timeframe in ordine cronologico (dalla piu' vecchia
// alla piu' recente). `limit`, se passato, prende le N candele piu' recenti
// mantenendo comunque l'ordine crescente in uscita.
export async function leggiCandeleMemoria(
  timeframe: CandleMemoryTimeframe,
  limit?: number
): Promise<CandelaMemoria[]> {
  const client = getPool();
  const res = limit
    ? await client.query(
        `SELECT * FROM (
           SELECT timeframe, datetime, open, high, low, close
           FROM candle_memory
           WHERE timeframe = $1
           ORDER BY datetime DESC
           LIMIT $2
         ) sub
         ORDER BY datetime ASC`,
        [timeframe, limit]
      )
    : await client.query(
        `SELECT timeframe, datetime, open, high, low, close
         FROM candle_memory
         WHERE timeframe = $1
         ORDER BY datetime ASC`,
        [timeframe]
      );

  return res.rows.map((r: { timeframe: string; datetime: string; open: string; high: string; low: string; close: string }) => ({
    timeframe: r.timeframe as CandleMemoryTimeframe,
    datetime: new Date(r.datetime).toISOString(),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}
