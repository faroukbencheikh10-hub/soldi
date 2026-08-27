import { NextResponse } from "next/server";
import { runAnalysis5m } from "@/lib/server/runAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runAnalysis5m({ force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/generate-5m] errore:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
