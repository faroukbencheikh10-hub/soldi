import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/server/db";
import { runAnalysis } from "@/lib/server/runAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === secret || querySecret === secret;
}

async function isSleepModeEnabled() {
  try {
    return (await getSetting("ai_paused")) === "true";
  } catch {
    // Se il DB non e' ancora inizializzato, runAnalysis gestisce ensureSchema.
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  try {
    if (await isSleepModeEnabled()) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "sleep_mode",
      });
    }

    const oro = await runAnalysis();
    return NextResponse.json({ ok: true, ...oro });
  } catch (err) {
    console.error("[cron/analyze] errore oro:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
