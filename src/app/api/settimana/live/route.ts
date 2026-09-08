import { NextRequest, NextResponse } from "next/server";
import { getOpenTrade, getTradeById, updateTradeLive } from "@/lib/server/settimana/repo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      eseguito_live?: boolean;
      note_live?: string;
    };
    const trade = body.id ? await getTradeById(body.id) : await getOpenTrade();
    if (!trade) {
      return NextResponse.json({ ok: false, error: "Trade non trovato" }, { status: 404 });
    }
    await updateTradeLive(trade.id, Boolean(body.eseguito_live), body.note_live ?? null);
    return NextResponse.json({ ok: true, id: trade.id, eseguito_live: Boolean(body.eseguito_live) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
