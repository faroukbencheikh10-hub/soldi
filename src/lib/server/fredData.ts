const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

const SERIES = {
  us10y: "DGS10",
  dollarIndex: "DTWEXBGS",
} as const;

export interface FredValue {
  value: number;
  changePct: number;
  quotedAt: number | null;
}

async function fetchSeries(seriesId: string): Promise<FredValue | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;

  try {
    const url =
      `${FRED_BASE}?series_id=${seriesId}` +
      `&api_key=${apiKey}` +
      `&file_type=json&sort_order=desc&limit=10`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json();
    const observations = data?.observations;
    if (!Array.isArray(observations)) return null;

    const valid: { n: number; date: string }[] = [];
    for (const obs of observations) {
      const n = Number(obs?.value);
      if (Number.isFinite(n)) valid.push({ n, date: String(obs?.date ?? "") });
      if (valid.length === 2) break;
    }

    if (valid.length === 0) return null;

    const latest = valid[0];
    const previous = valid.length > 1 ? valid[1].n : null;
    const changePct =
      previous !== null && previous !== 0 ? ((latest.n - previous) / previous) * 100 : 0;

    const parsed = latest.date ? Date.parse(`${latest.date}T00:00:00Z`) : NaN;

    return {
      value: latest.n,
      changePct: Number(changePct.toFixed(3)),
      quotedAt: Number.isFinite(parsed) ? parsed : null,
    };
  } catch {
    return null;
  }
}

export interface FredMacro {
  dxy: FredValue | null;
  us10y: FredValue | null;
}

export async function getMacroFromFred(): Promise<FredMacro> {
  const [dxy, us10y] = await Promise.all([
    fetchSeries(SERIES.dollarIndex),
    fetchSeries(SERIES.us10y),
  ]);

  return { dxy, us10y };
}
