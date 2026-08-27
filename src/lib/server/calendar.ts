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
