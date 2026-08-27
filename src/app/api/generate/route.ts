import { NextResponse } from "next/server";
import { ensureSchema, getSetting } from "@/lib/server/db";
import { runAnalysis } from "@/lib/server/runAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    await ensureSchema();
    if ((await getSetting("ai_paused")) === "true") {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "sleep_mode",
      });
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
