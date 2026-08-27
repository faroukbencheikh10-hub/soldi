import { XMLParser } from "fast-xml-parser";

const FEEDS: {
  url: string;
  tag: "financial" | "geopolitical";
  area: "asia" | "globale";
  sourceName?: string;
}[] = [
  { url: "https://www.cnbc.com/id/19832390/device/rss/rss.html", tag: "financial", area: "asia" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", tag: "financial", area: "globale" },
  { url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", tag: "financial", area: "globale" },
  { url: "https://www.cnbc.com/id/10000108/device/rss/rss.html", tag: "geopolitical", area: "globale" },
  // ForexLive rimosso: rispondeva HTTP 403 dagli IP di Vercel, quindi non
  // portava mai una notizia. Sostituito con due candidati: quello che non
  // risponde si vede subito in /api/debug/sources e si toglie.
  { url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", tag: "financial", area: "globale" },
  { url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", tag: "financial", area: "globale", sourceName: "WSJ Markets" },
];

const RELEVANCE_KEYWORDS = [
  "gold", "fed", "federal reserve", "inflation", "rate", "dollar", "treasury",
  "war", "geopolit", "trump", "tariff", "sanction", "oil", "opec",
  "china", "japan", "yuan", "yen", "boj", "pboc", "india", "bullion",
];

const MAX_AGE_HOURS = 24;

const parser = new XMLParser({ ignoreAttributes: false });

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string | null;
  tag: "financial" | "geopolitical" | "trump";
  area: "asia" | "globale";
}

interface NewsItemDraft {
  title: string;
  source: string;
  time: string | null;
  tag: "financial" | "geopolitical" | "trump";
  area: "asia" | "globale";
  timestamp: number;
}

async function fetchFeed(feed: (typeof FEEDS)[number], cutoff: number): Promise<NewsItemDraft[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item ?? [];
    const arr = Array.isArray(items) ? items : [items];

    const out: NewsItemDraft[] = [];

    for (const item of arr) {
      const title = String(item?.title ?? "");
      if (!title) continue;

      const isRelevant = RELEVANCE_KEYWORDS.some((k) => title.toLowerCase().includes(k));
      if (!isRelevant) continue;

      const pubDate = item?.pubDate ?? null;
      const timestamp = pubDate ? new Date(pubDate).getTime() : NaN;
      if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;

      out.push({
        title,
        source: feed.sourceName ?? (feed.area === "asia" ? "CNBC Asia" : "CNBC"),
        time: pubDate,
        tag: /trump/i.test(title) ? "trump" : feed.tag,
        area: feed.area,
        timestamp,
      });
    }

    return out;
  } catch {
    return [];
  }
}

export async function diagnoseFeeds() {
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

  return Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store",
        });
        if (!res.ok) {
          return { area: feed.area, stato: `HTTP ${res.status}`, grezzi: 0, rilevanti: 0, recenti: 0, esempi: [] as string[] };
        }
        const xml = await res.text();
        const parsed = parser.parse(xml);
        const items = parsed?.rss?.channel?.item ?? [];
        const arr = Array.isArray(items) ? items : [items];

        const titoli = arr.map((i: { title?: unknown }) => String(i?.title ?? "")).filter(Boolean);
        const rilevanti = titoli.filter((t: string) =>
          RELEVANCE_KEYWORDS.some((k) => t.toLowerCase().includes(k))
        );
        const recenti = arr.filter((i: { pubDate?: unknown }) => {
          const ts = i?.pubDate ? new Date(String(i.pubDate)).getTime() : NaN;
          return Number.isFinite(ts) && ts >= cutoff;
        });

        return {
          area: feed.area,
          stato: "ok",
          grezzi: titoli.length,
          rilevanti: rilevanti.length,
          recenti: recenti.length,
          esempi: titoli.slice(0, 4),
        };
      } catch (err) {
        return {
          area: feed.area,
          stato: `errore: ${err instanceof Error ? err.message : String(err)}`,
          grezzi: 0, rilevanti: 0, recenti: 0, esempi: [] as string[],
        };
      }
    })
  );
}

export async function getRelevantNews(maxItems = 15): Promise<NewsItem[]> {
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

  const results = await Promise.all(FEEDS.map((feed) => fetchFeed(feed, cutoff)));
  const allItems = results.flat();

  const seen = new Set<string>();
  const unique = allItems.filter((it) => {
    if (seen.has(it.title)) return false;
    seen.add(it.title);
    return true;
  });

  unique.sort((a, b) => b.timestamp - a.timestamp);

  return unique
    .slice(0, maxItems)
    .map(({ timestamp, ...rest }, index) => ({ id: `news-${index}`, ...rest }));
}
