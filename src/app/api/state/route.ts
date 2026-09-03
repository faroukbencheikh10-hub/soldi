import { NextResponse } from "next/server";
import {
  getLatestMarketSnapshot,
  getLatestContextSnapshot,
  getSignalHistory,
  getStats,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [marketSnapshot, contextSnapshot, history, stats] = await Promise.all([
      getLatestMarketSnapshot(),
      getLatestContextSnapshot(),
      getSignalHistory(50),
      getStats(),
    ]);

    return NextResponse.json({
      ok: true,
      marketSnapshot,
      contextSnapshot,
      history,
      stats,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
