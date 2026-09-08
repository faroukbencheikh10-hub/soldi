export type LatoSweep = "HIGH" | "LOW";
export type DirezioneAsia = "BUY" | "SELL";
export type EsitoAsia =
  | "OPEN"
  | "WIN"
  | "WIN_PARZIALE"
  | "LOSS"
  | "SESSION_CLOSE"
  | "MANUAL_CLOSE";
export type TipoLogAsia =
  | "RANGE"
  | "CHECK"
  | "SWEEP"
  | "NO_TRADE"
  | "SEGNALE"
  | "ESITO"
  | "SESSION_CLOSE";

export type StatoSessioneAsia =
  | "weekend"
  | "fuori_sessione"
  | "in_attesa_range"
  | "in_ricerca"
  | "chiusa";

export interface CandleNum {
  open: number;
  high: number;
  low: number;
  close: number;
  datetime: string;
}

export interface AsiaRangeRow {
  giorno: string;
  range_high: number;
  range_low: number;
  ampiezza: number;
  valido: boolean;
  motivo: string | null;
  created_at: string;
}

export interface AsiaTradeRow {
  id: string;
  giorno: string;
  direzione: DirezioneAsia;
  lato_sweep: LatoSweep;
  livello_sweep: number;
  profondita_sweep_usd: number | null;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number | null;
  aperto_il: string;
  chiuso_il: string | null;
  esito: EsitoAsia | null;
  r_finale: number | null;
  pnl_usd: number | null;
  mfe_usd: number | null;
  mae_usd: number | null;
  minuti_in_trade: number | null;
  ora_ingresso_utc: number | null;
  eseguito_live: boolean;
  note_live: string | null;
}

export const LOTTI_ASIA = 0.05;
export const USD_PER_DOLLARO_PREZZO = 5;
export const LOCK_MS = 60_000;
export const SPREAD_BUFFER_DEFAULT = 0.7;

export const SESSION_START_MIN = 0; // 00:00 UTC
export const SESSION_END_MIN = 7 * 60; // 07:00 UTC
export const RANGE_END_MIN = 2 * 60; // 02:00 UTC
export const SWEEP_END_MIN = 6 * 60 + 30; // 06:30 UTC

export const RANGE_MIN_USD = 4;
export const RANGE_MAX_USD = 15;
export const SWEEP_MIN_USD = 0.5;
export const STOP_OLTRE_SWEEP_USD = 0.5;
export const STOP_MIN_USD = 3;
export const STOP_MAX_USD = 5;
export const TP1_MIN_R = 1.5;
export const TP1_MIN_USD = 4;
export const CONFERMA_MS = 15 * 60_000;
export const MAX_TRADE_SESSIONE = 2;
