import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, chiamateAttive, setChiamateAttive } from "@/lib/server/db";
import { twilioConfigurato } from "@/lib/server/twilioCall";

export const dynamic = "force-dynamic";

// L'interruttore e' distinto dalla configurazione tecnica: "attive" dice se
// l'utente le vuole, "configurato" se le credenziali Twilio esistono su
// Vercel. La dashboard mostra "Twilio non configurato" se configurato e'
// false, cosi' non si accende un interruttore che non chiamerebbe comunque.
export async function GET() {
  try {
    await ensureSchema();
    const attive = await chiamateAttive();
    return NextResponse.json({ ok: true, attive, configurato: twilioConfigurato() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const attive = Boolean(body?.attive);
    await ensureSchema();
    await setChiamateAttive(attive);
    return NextResponse.json({ ok: true, attive, configurato: twilioConfigurato() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
