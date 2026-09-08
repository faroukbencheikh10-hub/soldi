import type { EventoChiave, FinestraEvitare, MappaSettimana, SettMapRow, Zona } from "./types";
import { compactCandles, getCandeleChiuse, getContestoSettimana, getFinnhubHighImpactWeek } from "./dati";
import { getMapForWeek, insertLog, insertMap } from "./repo";
import { weekStartIso, weekStartUtc } from "./week";
import { callOpenAiJson, openaiModel } from "./openai";

const MAPPA_PROMPT = `Sei un analista ICT su XAUUSD. Devi produrre UNA mappa della settimana (lunedì–venerdì), non un ordine.

Regole:
- direzione: BUY, SELL o NEUTRALE. NEUTRALE se il quadro è ambiguo.
- forza: bassa | media | alta
- motivo: massimo 3 righe, fatti dai dati. Se un dato manca è "N/D", non inventare.
- zonaBuy: discount (OTE Daily, low precedente, pool sotto). { da, a } in prezzo.
- zonaSell: premium (high precedente, apertura settimanale, pool sopra). { da, a } in prezzo.
- invalidazione: prezzo che annulla la mappa (chiusura H4 oltre quel livello).
- eventiChiave: solo high impact della settimana, orario UTC.
- orariDaEvitare: finestre ±30 minuti attorno agli high impact.

Rispondi SOLO con JSON:
{
  "direzione": "BUY"|"SELL"|"NEUTRALE",
  "forza": "bassa"|"media"|"alta",
  "motivo": "string",
  "zonaBuy": { "da": number|null, "a": number|null },
  "zonaSell": { "da": number|null, "a": number|null },
  "invalidazione": number|null,
  "eventiChiave": [{ "data": "YYYY-MM-DD", "oraUtc": "HH:MM", "nome": "string", "impatto": "high" }],
  "orariDaEvitare": [{ "daIso": "ISO-UTC", "aIso": "ISO-UTC", "nome": "string" }]
}`;

function n(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? Number(x.toFixed(2)) : null;
}

function zona(v: unknown): Zona {
  if (!v || typeof v !== "object") return { da: null, a: null };
  const o = v as { da?: unknown; a?: unknown };
  return { da: n(o.da), a: n(o.a) };
}

function parseEvento(e: unknown): EventoChiave | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const nome = String(o.nome ?? o.title ?? "").trim();
  if (!nome) return null;
  return {
    data: String(o.data ?? "").slice(0, 10) || "N/D",
    oraUtc: String(o.oraUtc ?? o.ora ?? "").slice(0, 8) || "N/D",
    nome,
    impatto: String(o.impatto ?? "high"),
  };
}

function parseFinestra(e: unknown): FinestraEvitare | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const daIso = String(o.daIso ?? "");
  const aIso = String(o.aIso ?? "");
  if (!Number.isFinite(new Date(daIso).getTime()) || !Number.isFinite(new Date(aIso).getTime())) return null;
  return { daIso, aIso, nome: String(o.nome ?? "evento") };
}

export function finestreDaEventi(
  eventi: Array<{ time: string; title: string }>
): FinestraEvitare[] {
  const out: FinestraEvitare[] = [];
  for (const e of eventi) {
    const t = new Date(e.time).getTime();
    if (!Number.isFinite(t)) continue;
    out.push({
      daIso: new Date(t - 30 * 60_000).toISOString(),
      aIso: new Date(t + 30 * 60_000).toISOString(),
      nome: e.title || "high impact",
    });
  }
  return out;
}

export function parseMappa(raw: unknown, fallbackFinestre: FinestraEvitare[]): MappaSettimana {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dirRaw = String(o.direzione ?? "").toUpperCase();
  const direzione = dirRaw === "BUY" || dirRaw === "SELL" ? dirRaw : "NEUTRALE";
  const forzaRaw = String(o.forza ?? "").toLowerCase();
  const forza = forzaRaw === "alta" || forzaRaw === "media" || forzaRaw === "bassa" ? forzaRaw : "bassa";
  const motivo = String(o.motivo ?? "N/D").split("\n").slice(0, 3).join("\n").slice(0, 600);
  const eventi = Array.isArray(o.eventiChiave)
    ? o.eventiChiave.map(parseEvento).filter((x): x is EventoChiave => x !== null)
    : [];
  const finestreAi = Array.isArray(o.orariDaEvitare)
    ? o.orariDaEvitare.map(parseFinestra).filter((x): x is FinestraEvitare => x !== null)
    : [];
  const orariDaEvitare = finestreAi.length > 0 ? finestreAi : fallbackFinestre;
  return {
    direzione,
    forza,
    motivo: motivo || "N/D",
    zonaBuy: zona(o.zonaBuy),
    zonaSell: zona(o.zonaSell),
    invalidazione: n(o.invalidazione),
    eventiChiave: eventi,
    orariDaEvitare,
  };
}

export function h4RompeInvalidazione(
  direzione: MappaSettimana["direzione"],
  invalidazione: number | null,
  h4Chiuse: { close: number }[]
): boolean {
  if (direzione === "NEUTRALE" || invalidazione == null) return false;
  const last = h4Chiuse[0];
  if (!last || !Number.isFinite(last.close)) return false;
  if (direzione === "BUY") return last.close < invalidazione;
  return last.close > invalidazione;
}

async function generaMappa(rigenerata: boolean, motivoRegen?: string): Promise<SettMapRow> {
  const week = weekStartIso();
  const ctx = await getContestoSettimana();
  const calendar =
    ctx.calendar.length > 0 ? ctx.calendar : await getFinnhubHighImpactWeek(weekStartUtc());
  const fallbackFinestre = finestreDaEventi(calendar);

  const payload = {
    week_start: week,
    modello: openaiModel(),
    rigenerata,
    motivo_rigenerazione: motivoRegen ?? null,
    candele: {
      weekly: compactCandles(ctx.weekly, 20),
      daily: compactCandles(ctx.daily, 30),
      h4: compactCandles(ctx.h4, 60),
    },
    livelli_chiave: ctx.livelli,
    dxy: ctx.macro.dxy.value ?? "N/D",
    dxy_var: ctx.macro.dxy.changePct ?? "N/D",
    us10y: ctx.macro.us10y.value ?? "N/D",
    us10y_var: ctx.macro.us10y.changePct ?? "N/D",
    calendario_high_impact: calendar.map((e) => ({
      time: e.time || "N/D",
      country: e.country || "N/D",
      title: e.title || "N/D",
      impact: e.impact || "high",
    })),
    news_cnbc: (ctx.news ?? []).slice(0, 20).map((n) => ({
      title: n.title ?? "N/D",
      time: n.time ?? "N/D",
      source: n.source ?? "CNBC",
    })),
    festivo_usa: ctx.festivoUsa ?? null,
    nota: "Dati assenti = N/D. Non inventare prezzi o orari.",
  };

  const raw = await callOpenAiJson(MAPPA_PROMPT, payload);
  const mappa = parseMappa(raw, fallbackFinestre);
  if (mappa.orariDaEvitare.length === 0 && fallbackFinestre.length > 0) {
    mappa.orariDaEvitare = fallbackFinestre;
  }

  const row = await insertMap(week, mappa, rigenerata);
  await insertLog("MAPPA", {
    week_start: week,
    direzione: mappa.direzione,
    forza: mappa.forza,
    rigenerata,
    invalidazione: mappa.invalidazione,
    modello: openaiModel(),
  });
  return row;
}

/** Mappa della settimana: una sola, rigenerata al massimo una volta se H4 chiude oltre invalidazione. */
export async function ensureMappa(now = new Date()): Promise<SettMapRow> {
  const week = weekStartIso(now);
  const existing = await getMapForWeek(week);
  if (!existing) return generaMappa(false);

  if (existing.rigenerata) return existing;

  const h4 = await getCandeleChiuse("4h", 8);
  if (h4RompeInvalidazione(existing.mappa.direzione, existing.mappa.invalidazione, h4)) {
    return generaMappa(true, `H4 close ${h4[0]?.close} oltre invalidazione ${existing.mappa.invalidazione}`);
  }
  return existing;
}
