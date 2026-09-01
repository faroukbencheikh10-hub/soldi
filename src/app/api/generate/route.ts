import { NextRequest, NextResponse } from "next/server";
import { runAnalysis } from "@/lib/server/runAnalysis";
import { getLatestSignal, getLatestMarketSnapshot } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PROTEZIONE DEI TRADE APERTI
//
// runAnalysis({ force: true }) chiude il trade in corso come BREAKEVEN per
// fare posto al nuovo segnale. Sui dati reali e' successo 20 volte in sette
// giorni, con una vita media di 35 minuti e un risultato medio di +0,22R:
// quasi meta' delle operazioni non ha ne' vinto ne' perso, e' stata
// interrotta a meta' volo, spesso mentre era in profitto.
//
// La generazione manuale resta possibile, ma su un trade aperto ora serve una
// conferma esplicita: { confermaChiusura: true } nel corpo della richiesta.
// Il primo click non chiude niente e restituisce cosa si sta per buttare via.
export async function POST(req: NextRequest) {
  try {
    let confermaChiusura = false;
    try {
      const body = await req.json();
      confermaChiusura = Boolean(body?.confermaChiusura);
    } catch {
      // corpo assente o non JSON: nessuna conferma, si resta nel caso protetto
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

        // Prezzo dall'ultimo snapshot gia' salvato: nessuna chiamata di rete
        // per una richiesta che potrebbe non concludersi in una generazione.
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
          (Date.now() - new Date(aperto.created_at).getTime()) / 60000
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
