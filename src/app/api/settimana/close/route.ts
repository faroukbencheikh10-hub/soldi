import { NextRequest, NextResponse } from "next/server";
import { getOpenTrade, getTradeById } from "@/lib/server/settimana/repo";
import { chiusuraManuale } from "@/lib/server/settimana/esiti";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; motivo?: string };
    const trade = body.id ? await getTradeById(body.id) : await getOpenTrade();
    if (!trade || trade.esito !== "OPEN") {
      return NextResponse.json({ ok: false, error: "Nessun trade aperto" }, { status: 404 });
    }
    await chiusuraManuale(trade, String(body.motivo ?? "manuale"));
    return NextResponse.json({ ok: true, id: trade.id, esito: "MANUAL_CLOSE" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
