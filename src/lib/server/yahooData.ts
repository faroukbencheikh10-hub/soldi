const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export interface YahooValue {
  value: number;
  changePct: number;
  quotedAt: number | null;
}

async function fetchQuote(symbol: string): Promise<YahooValue | null> {
  try {
    const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const current = Number(meta.regularMarketPrice);
    if (!Number.isFinite(current)) return null;

    const previous = Number(meta.chartPreviousClose ?? meta.previousClose);
    const changePct =
      Number.isFinite(previous) && previous !== 0 ? ((current - previous) / previous) * 100 : 0;

    const seconds = Number(meta.regularMarketTime);
    const quotedAt = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;

    return { value: current, changePct: Number(changePct.toFixed(3)), quotedAt };
  } catch {
    return null;
  }
}

export interface YahooMacro {
  dxy: YahooValue | null;
  us10y: YahooValue | null;
}

export async function getMacroFromYahoo(): Promise<YahooMacro> {
  const [dxy, us10y] = await Promise.all([fetchQuote("DX-Y.NYB"), fetchQuote("^TNX")]);
  return { dxy, us10y };
}
