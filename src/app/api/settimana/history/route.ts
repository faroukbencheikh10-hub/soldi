import { NextResponse } from "next/server";
import { getHistory } from "@/lib/server/settimana/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const history = await getHistory(24);
    return NextResponse.json(history, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
