-- Canale Asia — tabelle nuove (prefisso asia_).
-- Non tocca signals, market_snapshots, setup_events, market_context, app_settings.
-- Non tocca le tabelle sett_*.
-- Lock e ultimi errori vanno nella tabella settings esistente.
-- Esegui su Neon a mano.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asia_ranges (
  giorno DATE PRIMARY KEY,
  range_high NUMERIC NOT NULL,
  range_low NUMERIC NOT NULL,
  ampiezza NUMERIC NOT NULL,
  valido BOOLEAN NOT NULL DEFAULT false,
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asia_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giorno DATE NOT NULL,
  direzione TEXT NOT NULL CHECK (direzione IN ('BUY', 'SELL')),
  lato_sweep TEXT NOT NULL CHECK (lato_sweep IN ('HIGH', 'LOW')),
  livello_sweep NUMERIC NOT NULL,
  profondita_sweep_usd NUMERIC,
  entry NUMERIC NOT NULL,
  sl NUMERIC NOT NULL,
  tp1 NUMERIC NOT NULL,
  tp2 NUMERIC NOT NULL,
  rr NUMERIC,
  aperto_il TIMESTAMPTZ NOT NULL DEFAULT now(),
  chiuso_il TIMESTAMPTZ,
  esito TEXT CHECK (esito IN (
    'OPEN', 'WIN', 'WIN_PARZIALE', 'LOSS', 'SESSION_CLOSE', 'MANUAL_CLOSE'
  )),
  r_finale NUMERIC,
  pnl_usd NUMERIC,
  mfe_usd NUMERIC,
  mae_usd NUMERIC,
  minuti_in_trade INTEGER,
  ora_ingresso_utc INTEGER,
  eseguito_live BOOLEAN NOT NULL DEFAULT false,
  note_live TEXT
);
CREATE INDEX IF NOT EXISTS idx_asia_trades_giorno ON asia_trades (giorno DESC);
CREATE INDEX IF NOT EXISTS idx_asia_trades_aperto ON asia_trades (esito) WHERE esito = 'OPEN';

CREATE TABLE IF NOT EXISTS asia_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES asia_trades(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  price NUMERIC NOT NULL,
  pnl_r NUMERIC,
  pnl_usd NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_asia_snapshots_trade ON asia_snapshots (trade_id, ts DESC);

CREATE TABLE IF NOT EXISTS asia_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo TEXT NOT NULL CHECK (tipo IN (
    'RANGE', 'CHECK', 'SWEEP', 'NO_TRADE', 'SEGNALE', 'ESITO', 'SESSION_CLOSE'
  )),
  dettaglio JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_asia_log_ts ON asia_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_asia_log_tipo ON asia_log (tipo, ts DESC);
