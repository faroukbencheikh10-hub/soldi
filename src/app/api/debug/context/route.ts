import { NextResponse } from "next/server";
import { getSetting } from "@/lib/server/db";
import { getEventiSetupAttivi } from "@/lib/server/db";

// Ispezione della memoria: cosa il sistema "ricorda" del grafico in questo
// momento. Non ricalcola niente e non chiama nessuna API esterna: legge lo
// stato lasciato dall'ultimo ciclo del monitor.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [sintesi, ultimoControllo, impronta, eventi] = await Promise.all([
      getSetting("contesto_sintesi"),
      getSetting("monitor_last_checked_at"),
      getSetting("setup_fingerprint"),
      getEventiSetupAttivi(),
    ]);

    return NextResponse.json({
      ok: true,
      monitorUltimoControllo: ultimoControllo,
      contesto: sintesi ? JSON.parse(sintesi) : null,
      impronta,
      eventiAttivi: eventi.map((e: Record<string, unknown>) => ({
        tipo: e.tipo,
        timeframe: e.timeframe,
        direzione: e.direzione,
        livello: Number(e.livello),
        candela: e.candela_ts,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
