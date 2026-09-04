import { NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/server/pushSend";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await sendPushToAll({
      title: "Soldi ORB",
      body: "Il mercato ha chiuso.",
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
