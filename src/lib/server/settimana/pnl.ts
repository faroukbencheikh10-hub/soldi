import { SPREAD_BUFFER_DEFAULT, USD_PER_DOLLARO_PREZZO } from "./types";
import type { SettTradeRow } from "./types";

export function spreadBuffer(): number {
  const raw = process.env.SPREAD_BUFFER?.trim();
  if (!raw) return SPREAD_BUFFER_DEFAULT;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : SPREAD_BUFFER_DEFAULT;
}

export function slEffettivo(direzione: "BUY" | "SELL", sl: number): number {
  const buf = spreadBuffer();
  return direzione === "BUY" ? sl - buf : sl + buf;
}

export function rischioPrezzo(entry: number, sl: number): number {
  return Math.abs(entry - sl);
}

export function rDaPrezzo(direzione: "BUY" | "SELL", entry: number, sl: number, price: number): number | null {
  const risk = rischioPrezzo(entry, sl);
  if (risk <= 0) return null;
  const move = direzione === "BUY" ? price - entry : entry - price;
  return Number((move / risk).toFixed(3));
}

export function usdDaMove(movePrezzo: number): number {
  return Number((movePrezzo * USD_PER_DOLLARO_PREZZO).toFixed(2));
}

export function usdDaR(r: number, entry: number, sl: number): number {
  return usdDaMove(r * rischioPrezzo(entry, sl));
}

export function floating(trade: SettTradeRow, price: number) {
  const r = rDaPrezzo(trade.direzione, trade.entry, trade.sl, price);
  const move = trade.direzione === "BUY" ? price - trade.entry : trade.entry - price;
  return {
    pnlR: r,
    pnlUsd: usdDaMove(move),
  };
}

export function mergeMfeMae(
  direzione: "BUY" | "SELL",
  entry: number,
  priceHigh: number,
  priceLow: number,
  prevMfe: number | null,
  prevMae: number | null
) {
  const fav = direzione === "BUY" ? priceHigh - entry : entry - priceLow;
  const avverse = direzione === "BUY" ? entry - priceLow : priceHigh - entry;
  const mfe = Math.max(prevMfe ?? 0, usdDaMove(Math.max(0, fav)));
  const mae = Math.max(prevMae ?? 0, usdDaMove(Math.max(0, avverse)));
  return { mfe, mae };
}
