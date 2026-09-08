/** Lunedì 00:00 UTC della settimana che contiene `d`. */
export function weekStartUtc(d: Date = new Date()): Date {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay(); // 0 domenica
  const offset = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + offset);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

export function weekStartIso(d: Date = new Date()): string {
  return weekStartUtc(d).toISOString().slice(0, 10);
}

export function isWeekendUtc(d: Date = new Date()): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function isFridayAfterUtc(d: Date, hour: number, minute = 0): boolean {
  if (d.getUTCDay() !== 5) return false;
  return d.getUTCHours() > hour || (d.getUTCHours() === hour && d.getUTCMinutes() >= minute);
}

export function insideWindow(now: Date, daIso: string, aIso: string): boolean {
  const t = now.getTime();
  const a = new Date(daIso).getTime();
  const b = new Date(aIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return t >= a && t <= b;
}

export function giorniAperti(apertoIl: string, chiusoIl?: string | null): number {
  const start = new Date(apertoIl).getTime();
  const end = chiusoIl ? new Date(chiusoIl).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function weekdayUtcName(d: Date): string {
  return ["dom", "lun", "mar", "mer", "gio", "ven", "sab"][d.getUTCDay()] ?? "n/d";
}
