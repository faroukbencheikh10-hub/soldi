export interface EconomicEvent {
  id: string;
  time: string;
  country: string;
  title: string;
  impact: string;
  source?: string;
}

async function getFinnhubCalendar(): Promise<EconomicEvent[]> {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const events = data?.economicCalendar ?? [];

    return events
      .filter((e: { impact: string }) => e.impact === "high" || e.impact === "medium")
      .filter((e: { country: string }) => ["US", "USD", "EU", "EMU"].includes(e.country))
      .slice(0, 15)
      .map((e: { time: string; country: string; event: string; impact: string }, index: number) => ({
        id: `finnhub-${index}`,
        time: e.time,
        country: e.country,
        title: e.event,
        impact: e.impact,
        source: "Finnhub",
      }));
  } catch {
    return [];
  }
}

async function getForexFactoryCalendar(): Promise<EconomicEvent[]> {
  if (ffCache && Date.now() - ffCache.fetchedAt < FF_CACHE_TTL_MS) {
    return ffCache.data;
  }

  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!res.ok) return ffCache?.data ?? [];
    const data: ForexFactoryRawEvent[] = await res.json();
    if (!Array.isArray(data)) return ffCache?.data ?? [];

    const now = Date.now();
    const horizonMs = 3 * 24 * 60 * 60 * 1000;

    const events = data
      .filter((e) => ["USD", "EUR"].includes((e.country ?? "").toUpperCase()))
      .map((e) => ({ ...e, impact: mapFfImpact(e.impact) }))
      .filter((e): e is ForexFactoryRawEvent & { impact: string } => e.impact !== null)
      .filter((e) => {
        const t = e.date ? new Date(e.date).getTime() : NaN;
        return Number.isFinite(t) && t >= now - 60 * 60 * 1000 && t <= now + horizonMs;
      })
      .slice(0, 15)
      .map((e, index) => ({
        id: `ff-${index}`,
        time: e.date as string,
        country: (e.country ?? "").toUpperCase(),
        title: e.title ?? "",
        impact: e.impact as string,
        source: "ForexFactory",
      }));

    ffCache = { data: events, fetchedAt: now };
    return events;
  } catch {
    return ffCache?.data ?? [];
  }
}

let ffCache: { data: EconomicEvent[]; fetchedAt: number } | null = null;
const FF_CACHE_TTL_MS = 8 * 60 * 1000;

interface ForexFactoryRawEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
}

function mapFfImpact(impact: string | undefined): string | null {
  const v = (impact ?? "").toLowerCase();
  if (v === "high") return "high";
  if (v === "medium") return "medium";
  return null;
}

export async function getEconomicCalendar(): Promise<EconomicEvent[]> {
  const [finnhub, forexFactory] = await Promise.all([getFinnhubCalendar(), getForexFactoryCalendar()]);

  const seen = new Set<string>();
  const merged = [...finnhub, ...forexFactory].filter((e) => {
    const key = `${e.title.toLowerCase().trim()}|${e.time.slice(0, 16)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  merged.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return merged.slice(0, 25);
}

// ---------------------------------------------------------------------------
// FINESTRA NOTIZIE
//
// Il calendario economico arrivava gia' fin qui e finiva nel payload dell'AI,
// ma l'unico punto in cui influiva su una decisione era shouldCallAI (il gate
// Asia, oggi disattivato). In pratica: l'agente SAPEVA dell'ISM delle 16:00 e
// poteva generare un segnale lo stesso.
//
// Nei minuti intorno a un dato ad alto impatto il grafico non e' leggibile con
// la logica ICT: la candela ampia col corpo pieno non e' un displacement su
// liquidita', e' la reazione al dato, e i primi minuti sono tipicamente uno
// stop hunt in entrambe le direzioni. Qui si calcola solo se siamo dentro
// quella finestra; a fermare la generazione ci pensa runAnalysis.
// ---------------------------------------------------------------------------

// Ampiezza del silenzio per livello di impatto, in minuti. Prima dell'evento
// serve a non aprire posizioni che il dato spazzera' via; dopo, a non
// inseguire il primo movimento, che spesso viene ritracciato per intero.
const FINESTRA_MINUTI = {
  high: { prima: 30, dopo: 15 },
  medium: { prima: 10, dopo: 10 },
} as const;

export interface FinestraNotizie {
  attiva: boolean;
  evento: EconomicEvent | null;
  /** Minuti all'uscita: negativo se il dato e' gia' stato pubblicato. */
  minutiAllEvento: number | null;
  motivo: string | null;
}

export function finestraNotizie(
  eventi: EconomicEvent[],
  adesso: number = Date.now()
): FinestraNotizie {
  const spento: FinestraNotizie = {
    attiva: false,
    evento: null,
    minutiAllEvento: null,
    motivo: null,
  };
  if (!Array.isArray(eventi) || eventi.length === 0) return spento;

  // Gli eventi arrivano gia' filtrati su USD/EUR e impatto high/medium da
  // getEconomicCalendar: qui si guarda solo la distanza temporale.
  for (const e of eventi) {
    const ts = new Date(e.time).getTime();
    if (!Number.isFinite(ts)) continue;

    const ampiezza =
      e.impact === "high" ? FINESTRA_MINUTI.high : e.impact === "medium" ? FINESTRA_MINUTI.medium : null;
    if (!ampiezza) continue;

    const minuti = Math.round((ts - adesso) / 60000);
    if (minuti <= ampiezza.prima && minuti >= -ampiezza.dopo) {
      return {
        attiva: true,
        evento: e,
        minutiAllEvento: minuti,
        motivo:
          minuti >= 0
            ? `${e.title} (${e.country}, impatto ${e.impact}) fra ${minuti} minuti`
            : `${e.title} (${e.country}, impatto ${e.impact}) pubblicato ${Math.abs(minuti)} minuti fa`,
      };
    }
  }

  return spento;
}
