import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, isAiPaused, setAiPaused, getSetting } from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Lo stato della modalita' sonno viaggia sempre con l'istante in cui e'
// iniziata ("ai_paused_at", scritto da setAiPaused): la dashboard deve poter
// scrivere DA QUANDO l'AI e' ferma, non solo che lo e'.
export async function GET() {
  try {
    await ensureSchema();
    const [paused, pausedAt] = await Promise.all([
      isAiPaused(),
      getSetting("ai_paused_at"),
    ]);
    return NextResponse.json({ ok: true, paused, pausedAt: paused ? pausedAt : null });
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
    const paused = Boolean(body?.paused);
    await ensureSchema();
    await setAiPaused(paused);
    // Riletto dopo la scrittura invece di usare l'orario del client: e'
    // setAiPaused a decidere il timestamp, e deve essere quello a comparire.
    const pausedAt = paused ? await getSetting("ai_paused_at") : null;
    return NextResponse.json({ ok: true, paused, pausedAt });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
