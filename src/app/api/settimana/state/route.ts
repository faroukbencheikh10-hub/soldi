import { NextResponse } from "next/server";
import { getSettimanaState } from "@/lib/server/settimana/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getSettimanaState();
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
