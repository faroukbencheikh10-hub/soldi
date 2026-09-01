import { NextRequest, NextResponse } from "next/server";
import { getSegnaliConSnapshot } from "@/lib/server/db";
import { buildUserPayload, buildAiPayload, generateSignalDaPayload } from "@/lib/server/agent";
import { validateSignal } from "@/lib/server/validateSignal";
import { costruisciContesto, comprimiContesto, type EventoContesto } from "@/lib/server/marketContext";

// Test 3 richiesto: il payload nuovo deve produrre la STESSA decisione del
// vecchio su segnali gia' emessi. Rigioca gli ultimi N segnali usando lo
// snapshot di mercato salvato con ciascuno, costruisce entrambi i payload e
// (solo con ?ai=1) chiede a OpenAI la decisione su tutti e due.
//
// Senza ?ai=1 non chiama l'AI e si limita al confronto strutturale: verifica
// che ogni fatto presente nel payload vecchio esista ancora nel nuovo. Serve
// a non bruciare credito quando basta la verifica a costo zero.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Riga = Record<string, unknown>;

function foglie(v: unknown, prefisso = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) {
    v.forEach((x, i) => foglie(x, `${prefisso}[${i}]`, out));
    return out;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Riga)) foglie(x, prefisso ? `${prefisso}.${k}` : k, out);
    return out;
  }
  out.set(prefisso, String(v));
  return out;
}

/** Valori numerici/testuali presenti nel vecchio ma spariti nel nuovo. */
function fattiPersi(vecchio: unknown, nuovo: unknown): string[] {
  const nuoviValori = new Set(Array.from(foglie(nuovo).values()));
  const persi: string[] = [];
  for (const [path, val] of foglie(vecchio)) {
    // Le candele grezze del vecchio payload (100 per timeframe) sono state
    // sostituite di proposito da contesto + ultime 5 chiuse: non contano
    // come perdita di informazione, contano come deduplicazione.
    if (/^(candele|candles)/.test(path)) continue;
    if (!nuoviValori.has(val)) persi.push(`${path}=${val}`);
  }
  return persi;
}

export async function GET(req: NextRequest) {
  try {
    const n = Math.min(Number(req.nextUrl.searchParams.get("n") ?? 3) || 3, 10);
    const conAi = req.nextUrl.searchParams.get("ai") === "1";

    const righe = await getSegnaliConSnapshot(n);

    const esiti = [];
    for (const r of righe) {
      const snap = r.market_snapshot as never;
      const eventi: EventoContesto[] = [];
      const contesto = costruisciContesto(
        {
          prezzo: (r.market_snapshot as Riga).xauusd as number,
          candles: (r.market_snapshot as Riga).candles as never,
          atr30m: (r.market_snapshot as Riga).atr30m as number | null,
          atr15m: (r.market_snapshot as Riga).atr15m as number | null,
          atr5m: (r.market_snapshot as Riga).atr5m as number | null,
          liquidita24h: (r.market_snapshot as Riga).liquidita24h as never,
          // Snapshot vecchi non hanno i campi M15: su quelli le zone arrivano
          // vuote e il contesto M15 risulta semplicemente non calcolabile,
          // senza rompere il confronto storico.
          zoneM15: {
            orderBlocks: (r.market_snapshot as Riga).ictOrderBlocksM15 as never,
            fvg: (r.market_snapshot as Riga).ictFvgM15 as never,
            livelliUguali: (r.market_snapshot as Riga).ictLivelliUgualiM15 as never,
          },
          zoneM30: {
            orderBlocks: (r.market_snapshot as Riga).ictOrderBlocksM30 as never,
            fvg: (r.market_snapshot as Riga).ictFvgM30 as never,
            livelliUguali: (r.market_snapshot as Riga).ictLivelliUgualiM30 as never,
          },
          zoneM5: {
            orderBlocks: (r.market_snapshot as Riga).ictOrderBlocksM5 as never,
            fvg: (r.market_snapshot as Riga).ictFvgM5 as never,
            livelliUguali: null,
          },
        },
        eventi,
        []
      );

      const vecchio = buildUserPayload({ marketSnapshot: snap, news: [], calendar: [] });
      const nuovo = buildAiPayload({
        marketSnapshot: snap,
        news: [],
        calendar: [],
        memoriaMercato: comprimiContesto(contesto) as unknown as Record<string, unknown>,
        eventiAttivi: [],
        scenario: null,
      });

      const esito: Riga = {
        id: r.id,
        creatoIl: r.created_at,
        decisioneStorica: r.direction,
        fattiPersi: fattiPersi(vecchio, nuovo).slice(0, 25),
        caratteriVecchio: JSON.stringify(vecchio).length,
        caratteriNuovo: JSON.stringify(nuovo).length,
      };

      if (conAi) {
        const [dv, dn] = await Promise.all([
          generateSignalDaPayload(vecchio).catch((e) => ({ errore: String(e) })),
          generateSignalDaPayload(nuovo).catch((e) => ({ errore: String(e) })),
        ]);
        const norm = (x: Riga) => {
          if (x.errore) return String(x.errore).slice(0, 120);
          const v = validateSignal(x as never);
          return `${v.direction} conf=${v.confidence} rr=${v.riskReward ?? "-"}`;
        };
        esito.aiVecchio = norm(dv as Riga);
        esito.aiNuovo = norm(dn as Riga);
        esito.stessaDecisione = String(esito.aiVecchio).split(" ")[0] === String(esito.aiNuovo).split(" ")[0];
      }

      esiti.push(esito);
    }

    return NextResponse.json({
      ok: true,
      adesso: new Date().toISOString(),
      aiInterrogata: conAi,
      nota: conAi
        ? "stessaDecisione confronta solo BUY/SELL/NO_TRADE. Confidence e R:R possono variare: l'AI non e' deterministica."
        : "Confronto strutturale a costo zero. fattiPersi vuoto = il payload nuovo contiene tutti i valori del vecchio (candele grezze escluse di proposito). Aggiungi ?ai=1 per interrogare davvero OpenAI.",
      esiti,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
