import { NextRequest, NextResponse } from "next/server";
import { getStrategiaAttiva } from "@/lib/server/db";
import { runAnalysis5m } from "@/lib/server/runAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === secret || querySecret === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  // Il canale veloce non e' piu' spento via codice: gira se la strategia
  // scelta in dashboard lo include. Vedi getStrategiaAttiva in db.ts.
  // Letta in modo tollerante: questa chiamata avviene PRIMA di ensureSchema
  // (che sta dentro runAnalysis), quindi su un database nuovo la tabella
  // app_settings potrebbe non esistere ancora e la query fallirebbe. In quel
  // caso si assume "normale", cioe' il comportamento di sempre, e sara'
  // ensureSchema a creare la tabella al primo ciclo utile.
  let strategia: "normale" | "veloce" = "normale";
  try {
    strategia = await getStrategiaAttiva();
  } catch (err) {
    console.error("[cron] lettura strategia fallita, si assume normale:", err);
  }
  if (strategia !== "veloce") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "canale_non_attivo",
      note: `Canale veloce non attivo: strategia impostata su "${strategia}".`,
    });
  }

  try {
    const esito = await runAnalysis5m();
    return NextResponse.json({ ok: true, canale: "veloce", ...esito });
  } catch (err) {
    console.error("[cron/analyze-5m] errore:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
