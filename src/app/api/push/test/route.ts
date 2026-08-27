import { NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/server/pushSend";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await sendPushToAll({
      title: "Notifica di prova — Investment Pal",
      body: "Se vedi questo, le notifiche push funzionano correttamente.",
      url: "/",
      tag: "test-notification",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
