import { getMarketCalendarContext } from "@/lib/server/marketCalendar";
import {
  RANGE_END_MIN,
  SESSION_END_MIN,
  SESSION_START_MIN,
  SWEEP_END_MIN,
  type StatoSessioneAsia,
} from "./types";

/** Giorno di calendario UTC YYYY-MM-DD. */
export function giornoUtcIso(d: Date = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function isWeekendUtc(d: Date = new Date()): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function minutiUtc(d: Date = new Date()): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function isSessioneOperativa(d: Date = new Date()): boolean {
  if (isWeekendUtc(d)) return false;
  const m = minutiUtc(d);
  return m >= SESSION_START_MIN && m < SESSION_END_MIN;
}

/** Range calcolabile: lun–ven da 02:00 UTC in poi (anche dopo le 07:00, il range resta). */
export function isDopoCalcoloRange(d: Date = new Date()): boolean {
  if (isWeekendUtc(d)) return false;
  return minutiUtc(d) >= RANGE_END_MIN;
}

/** Sweep e nuovi ingressi: 02:00–06:30 UTC lun–ven. */
export function isFinestraSweep(d: Date = new Date()): boolean {
  if (isWeekendUtc(d)) return false;
  const m = minutiUtc(d);
  return m >= RANGE_END_MIN && m < SWEEP_END_MIN;
}

export function isChiusuraForzata(d: Date = new Date()): boolean {
  if (isWeekendUtc(d)) return false;
  return minutiUtc(d) >= SESSION_END_MIN;
}

export function statoSessione(d: Date = new Date(), rangePronto = false): StatoSessioneAsia {
  if (isWeekendUtc(d)) return "weekend";
  const m = minutiUtc(d);
  if (m >= SESSION_END_MIN) return "chiusa";
  if (!isSessioneOperativa(d)) return "fuori_sessione";
  if (m < RANGE_END_MIN || !rangePronto) return "in_attesa_range";
  return "in_ricerca";
}

export function festivoUsa(d: Date = new Date()): string | null {
  const cal = getMarketCalendarContext(d);
  return cal.new_york?.today?.holidayName ?? null;
}

export function inizioGiornoUtc(giornoIso: string): Date {
  const [y, m, day] = giornoIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
}

export function istanteUtc(giornoIso: string, hour: number, minute = 0): Date {
  const [y, m, day] = giornoIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, hour, minute, 0, 0));
}
