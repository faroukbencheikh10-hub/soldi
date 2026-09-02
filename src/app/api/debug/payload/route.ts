import { NextRequest, NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/server/marketData";
import { getRelevantNews } from "@/lib/server/news";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { getEventiSetupAttivi } from "@/lib/server/db";
import { buildUserPayload, buildAiPayload } from "@/lib/server/agent";
import { costruisciContesto, comprimiContesto, type EventoContesto } from "@/lib/server/marketContext";

// Confronto fra il payload storico (100 candele grezze) e quello compatto.
// Non chiama OpenAI: misura e basta. Serve a decidere con i numeri davanti se
// sostituire il payload vecchio.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function misura(payload: unknown) {
  const testo = JSON.stringify(payload);
  return {
    caratteri: testo.length,
    kb: Number((testo.length / 1024).toFixed(1)),
    tokenStimati: Math.round(testo.length / 3.5),
  };
}

export async function GET(req: NextRequest) {
  try {
    const [marketSnapshot, news, calendar, righeEventi] = await Promise.all([
      getMarketSnapshot(),
      getRelevantNews().catch(() => []),
      getEconomicCalendar().catch(() => []),
      getEventiSetupAttivi(),
    ]);

    const eventi: EventoContesto[] = righeEventi.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      tipo: r.tipo as EventoContesto["tipo"],
      timeframe: r.timeframe as EventoContesto["timeframe"],
      direzione: r.direzione as EventoContesto["direzione"],
      livello: Number(r.livello),
      candelaTs: new Date(String(r.candela_ts)).toISOString(),
    }));

    const contesto = costruisciContesto(
      {
        prezzo: marketSnapshot.xauusd,
        candles: marketSnapshot.candles,
        atr30m: marketSnapshot.atr30m,
        atr15m: marketSnapshot.atr15m,
        atr5m: marketSnapshot.atr5m,
        liquidita24h: marketSnapshot.liquidita24h,
        zoneM15: {
          orderBlocks: marketSnapshot.ictOrderBlocksM15,
          fvg: marketSnapshot.ictFvgM15,
          livelliUguali: marketSnapshot.ictLivelliUgualiM15,
        },
        zoneM30: {
          orderBlocks: marketSnapshot.ictOrderBlocksM30,
          fvg: marketSnapshot.ictFvgM30,
          livelliUguali: marketSnapshot.ictLivelliUgualiM30,
        },
        zoneM5: { orderBlocks: marketSnapshot.ictOrderBlocksM5, fvg: marketSnapshot.ictFvgM5, livelliUguali: null },
      },
      eventi
    );

    const vecchio = buildUserPayload({ marketSnapshot, news, calendar });
    const nuovo = buildAiPayload({
      marketSnapshot,
      news,
      calendar,
      memoriaMercato: comprimiContesto(contesto) as unknown as Record<string, unknown>,
      eventiAttivi: eventi.map((e) => ({ ...e, candelaTs: e.candelaTs })),
      scenario: null,
    });

    const mVecchio = misura(vecchio);
    const mNuovo = misura(nuovo);
    const risparmioPct = Number((100 * (1 - mNuovo.caratteri / mVecchio.caratteri)).toFixed(1));

    const completo = req.nextUrl.searchParams.get("full") === "1";

    return NextResponse.json({
      ok: true,
      adesso: new Date().toISOString(),
      payloadVecchio: mVecchio,
      payloadNuovo: mNuovo,
      risparmioPct,
      nota: "tokenStimati e' una stima a ~3,5 caratteri per token, non un conteggio reale",
      contenutoStrutturato: {
        memoria_mercato: nuovo.memoria_mercato,
        eventi_attivi: nuovo.eventi_attivi,
        scenario: nuovo.scenario,
        sintesi_d1_h4: nuovo.sintesi_d1_h4,
        candele_chiuse_recenti: {
          m15: nuovo.candele_chiuse_recenti.m15.length,
          m5: nuovo.candele_chiuse_recenti.m5.length,
        },
        alias_eventi: nuovo.eventi_attivi,
      },
      payloadNuovoCompleto: completo ? nuovo : "aggiungi ?full=1 per vederlo tutto",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
