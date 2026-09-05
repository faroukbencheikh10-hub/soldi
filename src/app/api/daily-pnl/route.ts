import { NextResponse } from "next/server";
import { getDailyPnl } from "@/lib/server/dailyPnl";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getDailyPnl();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
