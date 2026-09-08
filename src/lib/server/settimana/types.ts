export type DirezioneMappa = "BUY" | "SELL" | "NEUTRALE";
export type ForzaMappa = "bassa" | "media" | "alta";
export type EsitoTrade =
  | "OPEN"
  | "WIN"
  | "WIN_PARZIALE"
  | "LOSS"
  | "FRIDAY_CLOSE"
  | "MANUAL_CLOSE"
  | "NO_TRADE";
export type TipoLog = "MAPPA" | "CHECK" | "NO_TRADE" | "SEGNALE" | "ESITO" | "FRIDAY_CLOSE";

export interface Zona {
  da: number | null;
  a: number | null;
}

export interface EventoChiave {
  data: string;
  oraUtc: string;
  nome: string;
  impatto: string;
}

export interface FinestraEvitare {
  daIso: string;
  aIso: string;
  nome: string;
}

export interface MappaSettimana {
  direzione: DirezioneMappa;
  forza: ForzaMappa;
  motivo: string;
  zonaBuy: Zona;
  zonaSell: Zona;
  invalidazione: number | null;
  eventiChiave: EventoChiave[];
  orariDaEvitare: FinestraEvitare[];
}

export interface SettMapRow {
  id: string;
  week_start: string;
  mappa: MappaSettimana;
  rigenerata: boolean;
  created_at: string;
}

export interface SettTradeRow {
  id: string;
  week_start: string;
  map_id: string | null;
  direzione: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number | null;
  confidence: number | null;
  spiegazione: string | null;
  aperto_il: string;
  chiuso_il: string | null;
  esito: EsitoTrade | null;
  r_finale: number | null;
  pnl_usd: number | null;
  mfe_usd: number | null;
  mae_usd: number | null;
  giorni_in_trade: number | null;
  giorno_ingresso: string | null;
  eseguito_live: boolean;
  note_live: string | null;
}

export interface SettResultRow {
  week_start: string;
  direzione_prevista: string | null;
  chiusura_weekly_reale: number | null;
  direzione_reale: string | null;
  mappa_corretta: boolean | null;
  zona_buy_toccata: boolean | null;
  zona_sell_toccata: boolean | null;
  trade_id: string | null;
  evento_dominante: string | null;
}

export interface LivelliChiave {
  highSettimanaScorsa: number | null;
  lowSettimanaScorsa: number | null;
  aperturaSettimanale: number | null;
  highIeri: number | null;
  lowIeri: number | null;
}

export interface CandleNum {
  open: number;
  high: number;
  low: number;
  close: number;
  datetime: string;
}

export const LOTTI_SETTIMANA = 0.05;
export const USD_PER_DOLLARO_PREZZO = 5;
export const STOP_MIN_USD = 25;
export const STOP_MAX_USD = 80;
export const LOCK_MS = 90_000;
export const SPREAD_BUFFER_DEFAULT = 0.7;
