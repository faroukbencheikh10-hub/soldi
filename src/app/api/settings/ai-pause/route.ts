import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, isAiPaused, setAiPaused } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const paused = await isAiPaused();
    return NextResponse.json({ ok: true, paused });
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
    return NextResponse.json({ ok: true, paused });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
