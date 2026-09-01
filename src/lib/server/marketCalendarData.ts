// ---------------------------------------------------------------------------
// MARKET CALENDAR -- SOLO DATI
//
// Questo file contiene ESCLUSIVAMENTE dati: definizione dei quattro mercati e
// calendari annuali di festivita'. La logica vive in marketCalendar.ts.
// Aggiornare un anno significa aggiungere una voce qui dentro, senza toccare
// una riga di logica.
//
// REGOLA DI COMPILAZIONE: una data entra qui SOLO se verificata su fonte
// ufficiale. Se il calendario di un anno non e' verificato si lascia
// `verified: false` con `days: []`: il resto dell'app lo sapra' tramite
// holidayCalendarVerified e trattera' il dato come incerto, invece di
// presumere che sia tutto normale.
// ---------------------------------------------------------------------------

export type MarketId = "london" | "new_york" | "tokyo" | "comex_gold";

export interface TradingSession {
  /** 0 = domenica ... 6 = sabato. */
  weekdays: number[];
  /** HH:MM nel fuso locale del mercato. */
  start: string;
  /** HH:MM nel fuso locale del mercato. "24:00" e' ammesso. */
  end: string;
}

/** Una festivita', sempre espressa nella data LOCALE del mercato. */
export interface HolidayEntry {
  /** YYYY-MM-DD nel fuso del mercato. */
  date: string;
  name: string;
  /** true = mercato chiuso tutto il giorno. false = giornata speciale ma aperta. */
  closed: boolean;
  /** Override interno per mezze giornate: serve solo a calcolare OPEN/CLOSED correttamente. */
  sessions?: Omit<TradingSession, "weekdays">[];
  note?: string | null;
}

export interface MarketYearCalendar {
  /** false = calendario non verificato su fonte ufficiale: il dato holiday e' incerto. */
  verified: boolean;
  source: string;
  /** Quando e' stata fatta la verifica (YYYY-MM-DD). */
  checkedOn: string;
  days: HolidayEntry[];
}

export interface MarketDefinition {
  id: MarketId;
  name: string;
  /** Riferimento ufficiale (borsa/contratto). */
  reference: string;
  icon: string;
  /** Timezone IANA: unica fonte di verita' per sapere che giorno e' sul posto. */
  timezone: string;
  /** Giorni della settimana in cui il mercato opera (0 = domenica ... 6 = sabato). */
  tradingWeekdays: number[];
  /** Sessioni regolari usate SOLO per sapere se e' aperto in questo momento. */
  regularSessions: TradingSession[];
  /** Calendari per anno (chiave = anno a quattro cifre nel fuso del mercato). */
  holidayCalendars: Record<string, MarketYearCalendar>;
}

// ---------------------------------------------------------------------------
// LONDON -- London Stock Exchange
// ---------------------------------------------------------------------------

const LONDON_2026: MarketYearCalendar = {
  verified: true,
  // Calendario 2026 verificato sul Trading Calendar ufficiale LSE/Turquoise.
  // Il documento indica anche l'early close LSE alle 12:30.
  source: "London Stock Exchange / Turquoise Trading Calendar 2026 (docs.londonstockexchange.com)",
  checkedOn: "2026-08-31",
  days: [
    { date: "2026-01-01", name: "New Year's Day", closed: true },
    { date: "2026-04-03", name: "Good Friday", closed: true },
    { date: "2026-04-06", name: "Easter Monday", closed: true },
    { date: "2026-05-04", name: "Early May Bank Holiday", closed: true },
    { date: "2026-05-25", name: "Spring Bank Holiday", closed: true },
    { date: "2026-08-31", name: "Summer Bank Holiday", closed: true },
    {
      date: "2026-12-24",
      name: "Christmas Eve",
      closed: false,
      sessions: [{ start: "08:00", end: "12:30" }],
      note: "Mezza giornata",
    },
    { date: "2026-12-25", name: "Christmas Day", closed: true },
    { date: "2026-12-28", name: "Boxing Day (substitute)", closed: true },
    {
      date: "2026-12-31",
      name: "New Year's Eve",
      closed: false,
      sessions: [{ start: "08:00", end: "12:30" }],
      note: "Mezza giornata",
    },
  ],
};

const LONDON_2027: MarketYearCalendar = {
  verified: false,
  source: "non verificato: calendario LSE 2027 non confermato su fonte ufficiale",
  checkedOn: "2026-08-31",
  days: [],
};

// ---------------------------------------------------------------------------
// NEW YORK -- NYSE
// ---------------------------------------------------------------------------

const NEW_YORK_2026: MarketYearCalendar = {
  verified: true,
  source: "NYSE Group Holiday and Early Closings Calendar 2025-2027 (nyse.com/markets/hours-calendars)",
  checkedOn: "2026-08-31",
  days: [
    { date: "2026-01-01", name: "New Year's Day", closed: true },
    { date: "2026-01-19", name: "Martin Luther King, Jr. Day", closed: true },
    { date: "2026-02-16", name: "Washington's Birthday", closed: true },
    { date: "2026-04-03", name: "Good Friday", closed: true },
    { date: "2026-05-25", name: "Memorial Day", closed: true },
    { date: "2026-06-19", name: "Juneteenth", closed: true },
    { date: "2026-07-03", name: "Independence Day (observed)", closed: true },
    { date: "2026-09-07", name: "Labor Day", closed: true },
    { date: "2026-11-26", name: "Thanksgiving Day", closed: true },
    {
      date: "2026-11-27",
      name: "Day after Thanksgiving",
      closed: false,
      sessions: [{ start: "09:30", end: "13:00" }],
      note: "Chiusura anticipata",
    },
    {
      date: "2026-12-24",
      name: "Christmas Eve",
      closed: false,
      sessions: [{ start: "09:30", end: "13:00" }],
      note: "Chiusura anticipata",
    },
    { date: "2026-12-25", name: "Christmas Day", closed: true },
  ],
};

const NEW_YORK_2027: MarketYearCalendar = {
  verified: true,
  source: "NYSE Group Holiday and Early Closings Calendar 2025-2027 (nyse.com/markets/hours-calendars)",
  checkedOn: "2026-08-31",
  days: [
    { date: "2027-01-01", name: "New Year's Day", closed: true },
    { date: "2027-01-18", name: "Martin Luther King, Jr. Day", closed: true },
    { date: "2027-02-15", name: "Washington's Birthday", closed: true },
    { date: "2027-03-26", name: "Good Friday", closed: true },
    { date: "2027-05-31", name: "Memorial Day", closed: true },
    { date: "2027-06-18", name: "Juneteenth (observed)", closed: true },
    { date: "2027-07-05", name: "Independence Day (observed)", closed: true },
    { date: "2027-09-06", name: "Labor Day", closed: true },
    { date: "2027-11-25", name: "Thanksgiving Day", closed: true },
    {
      date: "2027-11-26",
      name: "Day after Thanksgiving",
      closed: false,
      sessions: [{ start: "09:30", end: "13:00" }],
      note: "Chiusura anticipata",
    },
    { date: "2027-12-24", name: "Christmas Day (observed)", closed: true },
  ],
};

// ---------------------------------------------------------------------------
// TOKYO -- JPX / Tokyo Stock Exchange
// ---------------------------------------------------------------------------

const TOKYO_2026: MarketYearCalendar = {
  verified: true,
  source: "JPX Market Holidays (jpx.co.jp/english/corporate/about-jpx/calendar/), aggiornato 06/02/2026",
  checkedOn: "2026-08-31",
  days: [
    { date: "2026-01-01", name: "New Year's Day", closed: true },
    { date: "2026-01-02", name: "Market Holiday", closed: true },
    { date: "2026-01-03", name: "Market Holiday", closed: true },
    { date: "2026-01-12", name: "Coming of Age Day", closed: true },
    { date: "2026-02-11", name: "National Foundation Day", closed: true },
    { date: "2026-02-23", name: "Emperor's Birthday", closed: true },
    { date: "2026-03-20", name: "Vernal Equinox", closed: true },
    { date: "2026-04-29", name: "Showa Day", closed: true },
    { date: "2026-05-03", name: "Constitution Memorial Day", closed: true },
    { date: "2026-05-04", name: "Greenery Day", closed: true },
    { date: "2026-05-05", name: "Children's Day", closed: true },
    { date: "2026-05-06", name: "Constitution Memorial Day (observed)", closed: true },
    { date: "2026-07-20", name: "Marine Day", closed: true },
    { date: "2026-08-11", name: "Mountain Day", closed: true },
    { date: "2026-09-21", name: "Respect for the Aged Day", closed: true },
    { date: "2026-09-22", name: "Holiday", closed: true },
    { date: "2026-09-23", name: "Autumnal Equinox", closed: true },
    { date: "2026-10-12", name: "Sports Day", closed: true },
    { date: "2026-11-03", name: "Culture Day", closed: true },
    { date: "2026-11-23", name: "Labor Thanksgiving Day", closed: true },
    { date: "2026-12-31", name: "Market Holiday", closed: true },
  ],
};

const TOKYO_2027: MarketYearCalendar = {
  verified: true,
  source: "JPX Market Holidays (jpx.co.jp/english/corporate/about-jpx/calendar/), aggiornato 06/02/2026",
  checkedOn: "2026-08-31",
  days: [
    { date: "2027-01-01", name: "New Year's Day", closed: true },
    { date: "2027-01-02", name: "Market Holiday", closed: true },
    { date: "2027-01-03", name: "Market Holiday", closed: true },
    { date: "2027-01-11", name: "Coming of Age Day", closed: true },
    { date: "2027-02-11", name: "National Foundation Day", closed: true },
    { date: "2027-02-23", name: "Emperor's Birthday", closed: true },
    { date: "2027-03-21", name: "Vernal Equinox", closed: true },
    { date: "2027-03-22", name: "Vernal Equinox (observed)", closed: true },
    { date: "2027-04-29", name: "Showa Day", closed: true },
    { date: "2027-05-03", name: "Constitution Memorial Day", closed: true },
    { date: "2027-05-04", name: "Greenery Day", closed: true },
    { date: "2027-05-05", name: "Children's Day", closed: true },
    { date: "2027-07-19", name: "Marine Day", closed: true },
    { date: "2027-08-11", name: "Mountain Day", closed: true },
    { date: "2027-09-20", name: "Respect for the Aged Day", closed: true },
    { date: "2027-09-23", name: "Autumnal Equinox", closed: true },
    { date: "2027-10-11", name: "Sports Day", closed: true },
    { date: "2027-11-03", name: "Culture Day", closed: true },
    { date: "2027-11-23", name: "Labor Thanksgiving Day", closed: true },
    { date: "2027-12-31", name: "Market Holiday", closed: true },
  ],
};

// ---------------------------------------------------------------------------
// COMEX GOLD -- CME/COMEX Gold futures (GC) su CME Globex
//
// ATTENZIONE: si tratta del contratto GC classico, NON dei nuovi prodotti CME
// "1-Ounce Gold" a negoziazione continua.
//
// Il calendario festivo NON e' verificato. CME pubblica gli orari specifici per
// prodotto solo circa due settimane prima di ogni festivita' ("Trading hours are
// usually finalized approximately two weeks prior to the holiday"), e la tabella
// per prodotto su cmegroup.com/trading-hours.html e' generata via JavaScript:
// non e' stato possibile leggere gli orari GC per le singole date.
//
// Per non inventare nulla, `days` resta vuoto e `verified` resta false. Le
// festivita' che CME dichiara come impattate nel 2026 sono, come promemoria per
// il completamento manuale (NON usare senza verificare l'orario GC reale):
// New Year's, MLK, Presidents Day, Good Friday, Memorial Day, Juneteenth,
// Independence Day, Labor Day, Thanksgiving, Christmas.
// ---------------------------------------------------------------------------

const COMEX_GOLD_2026: MarketYearCalendar = {
  verified: false,
  source:
    "non verificato: orari GC per singola festivita' pubblicati da CME solo ~2 settimane prima e non leggibili dalla pagina ufficiale",
  checkedOn: "2026-08-31",
  days: [],
};

const COMEX_GOLD_2027: MarketYearCalendar = {
  verified: false,
  source: "non verificato: calendario CME/COMEX 2027 non confermato su fonte ufficiale",
  checkedOn: "2026-08-31",
  days: [],
};

// ---------------------------------------------------------------------------
// DEFINIZIONE DEI QUATTRO MERCATI
// ---------------------------------------------------------------------------

export const MARKET_DEFINITIONS: MarketDefinition[] = [
  {
    id: "london",
    name: "London",
    reference: "London Stock Exchange",
    icon: "\u{1F1EC}\u{1F1E7}",
    timezone: "Europe/London",
    tradingWeekdays: [1, 2, 3, 4, 5],
    regularSessions: [{ weekdays: [1, 2, 3, 4, 5], start: "08:00", end: "16:30" }],
    holidayCalendars: { "2026": LONDON_2026, "2027": LONDON_2027 },
  },
  {
    id: "new_york",
    name: "New York",
    reference: "NYSE",
    icon: "\u{1F1FA}\u{1F1F8}",
    timezone: "America/New_York",
    tradingWeekdays: [1, 2, 3, 4, 5],
    regularSessions: [{ weekdays: [1, 2, 3, 4, 5], start: "09:30", end: "16:00" }],
    holidayCalendars: { "2026": NEW_YORK_2026, "2027": NEW_YORK_2027 },
  },
  {
    id: "tokyo",
    name: "Tokyo",
    reference: "JPX / Tokyo Stock Exchange",
    icon: "\u{1F1EF}\u{1F1F5}",
    timezone: "Asia/Tokyo",
    tradingWeekdays: [1, 2, 3, 4, 5],
    regularSessions: [
      { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "11:30" },
      { weekdays: [1, 2, 3, 4, 5], start: "12:30", end: "15:30" },
    ],
    holidayCalendars: { "2026": TOKYO_2026, "2027": TOKYO_2027 },
  },
  {
    id: "comex_gold",
    name: "COMEX Gold",
    reference: "CME/COMEX Gold futures (GC)",
    icon: "\u{1F947}",
    timezone: "America/Chicago",
    tradingWeekdays: [0, 1, 2, 3, 4, 5],
    regularSessions: [
      { weekdays: [0], start: "17:00", end: "24:00" },
      { weekdays: [1, 2, 3, 4], start: "00:00", end: "16:00" },
      { weekdays: [1, 2, 3, 4], start: "17:00", end: "24:00" },
      { weekdays: [5], start: "00:00", end: "16:00" },
    ],
    holidayCalendars: { "2026": COMEX_GOLD_2026, "2027": COMEX_GOLD_2027 },
  },
];
