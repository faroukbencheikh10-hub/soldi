-- Trade della settimana — tabelle nuove (prefisso sett_).
-- Non tocca signals, market_snapshots, setup_events, market_context, app_settings.
-- Lock e ultimi errori vanno nella tabella settings esistente (stessa di dailyPnl).
-- Esegui su Neon a mano.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sett_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  mappa JSONB NOT NULL,
  rigenerata BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sett_maps_week ON sett_maps (week_start DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS sett_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  map_id UUID REFERENCES sett_maps(id),
  direzione TEXT NOT NULL CHECK (direzione IN ('BUY', 'SELL')),
  entry NUMERIC NOT NULL,
  sl NUMERIC NOT NULL,
  tp1 NUMERIC NOT NULL,
  tp2 NUMERIC NOT NULL,
  rr NUMERIC,
  confidence NUMERIC,
  spiegazione TEXT,
  aperto_il TIMESTAMPTZ NOT NULL DEFAULT now(),
  chiuso_il TIMESTAMPTZ,
  esito TEXT CHECK (esito IN ('OPEN', 'WIN', 'WIN_PARZIALE', 'LOSS', 'FRIDAY_CLOSE', 'MANUAL_CLOSE', 'NO_TRADE')),
  r_finale NUMERIC,
  pnl_usd NUMERIC,
  mfe_usd NUMERIC,
  mae_usd NUMERIC,
  giorni_in_trade INTEGER,
  giorno_ingresso TEXT,
  eseguito_live BOOLEAN NOT NULL DEFAULT false,
  note_live TEXT
);
CREATE INDEX IF NOT EXISTS idx_sett_trades_week ON sett_trades (week_start DESC);
CREATE INDEX IF NOT EXISTS idx_sett_trades_aperto ON sett_trades (esito) WHERE esito = 'OPEN';

CREATE TABLE IF NOT EXISTS sett_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES sett_trades(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  price NUMERIC NOT NULL,
  pnl_r NUMERIC,
  pnl_usd NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_sett_snapshots_trade ON sett_snapshots (trade_id, ts DESC);

CREATE TABLE IF NOT EXISTS sett_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo TEXT NOT NULL CHECK (tipo IN ('MAPPA', 'CHECK', 'NO_TRADE', 'SEGNALE', 'ESITO', 'FRIDAY_CLOSE')),
  dettaglio JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sett_log_ts ON sett_log (ts DESC);

CREATE TABLE IF NOT EXISTS sett_results (
  week_start DATE PRIMARY KEY,
  direzione_prevista TEXT,
  chiusura_weekly_reale NUMERIC,
  direzione_reale TEXT,
  mappa_corretta BOOLEAN,
  zona_buy_toccata BOOLEAN,
  zona_sell_toccata BOOLEAN,
  trade_id UUID REFERENCES sett_trades(id),
  evento_dominante TEXT
);
