import { NextRequest, NextResponse } from "next/server";
import { runTrendAnalysis as runAnalysis } from "@/lib/server/runTrendAnalysis";
import { getLatestSignal, getLatestMarketSnapshot } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    let confermaChiusura = false;
    try {
      const body = await req.json();
      confermaChiusura = Boolean(body?.confermaChiusura);
    } catch {
      // corpo assente
    }

    if (!confermaChiusura) {
      const aperto = await getLatestSignal();
      const inCorso =
        aperto &&
        (aperto.direction === "BUY" || aperto.direction === "SELL") &&
        !aperto.outcome;

      if (inCorso) {
        const entry = Number(aperto.entry);
        const stopLoss = Number(aperto.stop_loss);

        if (!aperto.attivato_il) {
          return NextResponse.json({
            ok: true,
            skipped: true,
            reason: "conferma_richiesta_attesa",
            activeSignalId: aperto.id,
            direction: aperto.direction,
            entry,
          });
        }

        const snapshot = await getLatestMarketSnapshot();
        const prezzo =
          snapshot?.xauusd !== null && snapshot?.xauusd !== undefined
            ? Number(snapshot.xauusd)
            : null;

        const rischio = Math.abs(entry - stopLoss);
        const risultatoR =
          prezzo !== null && Number.isFinite(prezzo) && rischio > 0
            ? Number(
                ((aperto.direction === "BUY" ? prezzo - entry : entry - prezzo) / rischio).toFixed(2)
              )
            : null;
        const minutiAperto = Math.round(
          (Date.now() - new Date(aperto.attivato_il).getTime()) / 60000
        );

        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "conferma_richiesta",
          activeSignalId: aperto.id,
          direction: aperto.direction,
          entry,
          stopLoss,
          tp1: Number(aperto.tp1),
          prezzoCorrente: prezzo,
          risultatoR,
          minutiAperto,
        });
      }
    }

    const result = await runAnalysis({ force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/generate] errore:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
