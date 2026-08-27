import { NextResponse } from "next/server";
import {
  getLatestMarketSnapshot,
  getLatestContextSnapshot,
  getSignalHistory,
  getStats,
  getSignalHistory5m,
  getStats5m,
  getSignalHistory30m,
  getStats30m,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      marketSnapshot,
      contextSnapshot,
      history,
      stats,
      history5m,
      stats5m,
      history30m,
      stats30m,
    ] = await Promise.all([
      getLatestMarketSnapshot(),
      getLatestContextSnapshot(),
      getSignalHistory(50),
      getStats(),
      getSignalHistory5m(50),
      getStats5m(),
      getSignalHistory30m(50),
      getStats30m(),
    ]);

    return NextResponse.json({
      ok: true,
      marketSnapshot,
      contextSnapshot,
      history,
      stats,
      history5m,
      stats5m,
      history30m,
      stats30m,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
