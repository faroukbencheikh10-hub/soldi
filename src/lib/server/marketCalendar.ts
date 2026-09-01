// ---------------------------------------------------------------------------
// MARKET CALENDAR -- LOGICA SEMPLICE
//
// Per London, New York, Tokyo e COMEX Gold risponde solo a queste domande:
// - il mercato e' OPEN o CLOSED in questo momento?
// - oggi e' una festivita' di mercato?
// - la giornata di mercato precedente rilevante era una festivita'?
//
// Gli orari servono solo internamente per calcolare OPEN/CLOSED. Non ci sono
// countdown, polling, route dedicate o regole di trading aggiuntive.
//
// QUESTO MODULO NON DECIDE NULLA SUI TRADE. Produce solo contesto per l'AI e
// per la dashboard. ICT resta il decisore tecnico.
// ---------------------------------------------------------------------------

import {
  MARKET_DEFINITIONS,
  type HolidayEntry,
  type MarketDefinition,
  type MarketId,
  type TradingSession,
} from "@/lib/server/marketCalendarData";

export type MarketStatus = "open" | "closed";

export interface MarketTodayStatus {
  /** Data locale del mercato, YYYY-MM-DD. */
  date: string;
  /** Stato reale in questo momento, non semplicemente "giorno lavorativo". */
  status: MarketStatus;
  /** Solo festivita' che chiudono davvero il mercato per l'intera giornata. */
  holidayName: string | null;
}

export interface PreviousHolidayContext {
  date: string;
  name: string;
}

export interface MarketCalendarStatus {
  id: MarketId;
  name: string;
  icon: string;
  timezone: string;
  today: MarketTodayStatus;
  /**
   * Ultima festivita' di chiusura ancora rilevante per la giornata corrente.
   * Esempio: martedi' 01/09/2026 -> London ricorda il Bank Holiday di lunedi'.
   * Se nel frattempo c'e' gia' stata una normale giornata di mercato, e' null.
   */
  previousHoliday: PreviousHolidayContext | null;
  /** false = calendario festivo dell'anno corrente non verificato. */
  holidayCalendarVerified: boolean;
}

export type MarketCalendarContext = Record<MarketId, MarketCalendarStatus>;

// ---------------------------------------------------------------------------
// Ora/data locale del mercato
// ---------------------------------------------------------------------------

interface LocalClock {
  date: string;
  weekday: number;
  minutes: number;
}

const clockFormatterCache = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = clockFormatterCache.get(timeZone);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  clockFormatterCache.set(timeZone, created);
  return created;
}

function orologioLocale(date: Date, timeZone: string): LocalClock {
  const parts = clockFormatter(timeZone).formatToParts(date);
  const get = (tipo: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === tipo)?.value ?? "";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const dayOfMonth = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekdayText = get("weekday");

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdays[weekdayText];

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(dayOfMonth) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    weekday === undefined
  ) {
    throw new Error(`Impossibile calcolare l'orario locale per ${timeZone}`);
  }

  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`,
    weekday,
    minutes: hour * 60 + minute,
  };
}

function giornoPrecedente(data: string): string {
  const [y, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function giornoSettimana(data: string): number {
  const [y, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function minutiDaOra(ora: string): number {
  const [h, m] = ora.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Festivita' e sessioni
// ---------------------------------------------------------------------------

function calendarioAnno(mercato: MarketDefinition, data: string) {
  return mercato.holidayCalendars[data.slice(0, 4)];
}

function entryFestiva(mercato: MarketDefinition, data: string): HolidayEntry | null {
  return calendarioAnno(mercato, data)?.days.find((g) => g.date === data) ?? null;
}

function sessioniPerOggi(
  mercato: MarketDefinition,
  clock: LocalClock,
  holiday: HolidayEntry | null
): TradingSession[] {
  if (holiday?.closed) return [];

  // Le sessioni speciali servono solo a rendere OPEN/CLOSED corretto nelle
  // mezze giornate. Non vengono esposte in dashboard o nel prompt AI.
  if (holiday?.sessions) {
    return holiday.sessions.map((s) => ({ ...s, weekdays: [clock.weekday] }));
  }

  return mercato.regularSessions.filter((s) => s.weekdays.includes(clock.weekday));
}

function eApertoOra(sessioni: TradingSession[], minuti: number): boolean {
  return sessioni.some((s) => {
    const inizio = minutiDaOra(s.start);
    const fine = minutiDaOra(s.end);
    return minuti >= inizio && minuti < fine;
  });
}

/**
 * Cerca la festivita' di chiusura immediatamente precedente ancora rilevante.
 * Attraversa soltanto giorni in cui il mercato sarebbe normalmente chiuso
 * (es. weekend). Appena incontra una normale giornata di mercato, si ferma.
 *
 * Cosi' un Bank Holiday di lunedi' e' ricordato martedi'; una festivita' di
 * venerdi' e' ricordata lunedi' dopo il weekend; martedi' non viene piu' inviata.
 */
function festivitaPrecedenteRilevante(
  mercato: MarketDefinition,
  oggi: string
): PreviousHolidayContext | null {
  let data = giornoPrecedente(oggi);

  // 7 giorni sono piu' che sufficienti per attraversare weekend e ponti
  // consecutivi senza mantenere vecchio contesto per troppo tempo.
  for (let i = 0; i < 7; i += 1) {
    const holiday = entryFestiva(mercato, data);
    if (holiday?.closed) return { date: data, name: holiday.name };

    const weekday = giornoSettimana(data);
    const normalmenteOperativo = mercato.tradingWeekdays.includes(weekday);
    if (normalmenteOperativo) return null;

    data = giornoPrecedente(data);
  }

  return null;
}

function statoMercato(mercato: MarketDefinition, adesso: Date): MarketCalendarStatus {
  const clock = orologioLocale(adesso, mercato.timezone);
  const holiday = entryFestiva(mercato, clock.date);
  const sessioni = sessioniPerOggi(mercato, clock, holiday);
  const aperto = eApertoOra(sessioni, clock.minutes);

  return {
    id: mercato.id,
    name: mercato.name,
    icon: mercato.icon,
    timezone: mercato.timezone,
    today: {
      date: clock.date,
      status: aperto ? "open" : "closed",
      holidayName: holiday?.closed ? holiday.name : null,
    },
    previousHoliday: festivitaPrecedenteRilevante(mercato, clock.date),
    holidayCalendarVerified: calendarioAnno(mercato, clock.date)?.verified ?? false,
  };
}

/** Nessuna rete, database o API esterna: solo orari + calendari locali. */
export function getMarketCalendarContext(date: Date = new Date()): MarketCalendarContext {
  const out = {} as MarketCalendarContext;
  for (const mercato of MARKET_DEFINITIONS) {
    out[mercato.id] = statoMercato(mercato, date);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Payload minimale per l'AI
// ---------------------------------------------------------------------------

interface CompactMarket {
  status: "OPEN" | "CLOSED";
  holiday?: string;
  previous_holiday?: PreviousHolidayContext;
  calendar_verified?: false;
}

/**
 * L'AI riceve solo lo stato attuale, l'eventuale festivita' di oggi e, se
 * rilevante, la festivita' precedente. Niente countdown o dettagli di orario.
 */
export function buildCompactCalendarContext(
  contesto: MarketCalendarContext
): Record<MarketId, CompactMarket> {
  const uno = (s: MarketCalendarStatus): CompactMarket => {
    const out: CompactMarket = {
      status: s.today.status === "open" ? "OPEN" : "CLOSED",
    };
    if (s.today.holidayName) out.holiday = s.today.holidayName;
    if (s.previousHoliday) out.previous_holiday = s.previousHoliday;
    if (!s.holidayCalendarVerified) out.calendar_verified = false;
    return out;
  };

  return {
    london: uno(contesto.london),
    new_york: uno(contesto.new_york),
    tokyo: uno(contesto.tokyo),
    comex_gold: uno(contesto.comex_gold),
  };
}
