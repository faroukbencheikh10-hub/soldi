import { NextResponse } from "next/server";
import { getTickerState } from "@/lib/server/db";

// Endpoint leggero: restituisce solo i pochi campi che servono al ticker del
// prezzo e al controllo dei nuovi segnali. Prima questi due componenti
// chiamavano /api/state, che scarica gli snapshot completi (candele comprese)
// e 150 righe di storico: centinaia di KB per leggerne una manciata di byte.
// Era la voce principale del consumo di trasferimento dati su Neon.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getTickerState();
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
