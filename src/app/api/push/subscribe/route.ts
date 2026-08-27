import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, savePushSubscription, deletePushSubscription } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const subscription = await req.json();
    const endpoint = subscription?.endpoint;
    if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: "Subscription non valida" }, { status: 400 });
    }

    await ensureSchema();
    await savePushSubscription(endpoint, subscription);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe] errore:", err);
    return NextResponse.json({ error: "Errore interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json();
    if (!endpoint) return NextResponse.json({ error: "endpoint mancante" }, { status: 400 });

    await deletePushSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe DELETE] errore:", err);
    return NextResponse.json({ error: "Errore interno" }, { status: 500 });
  }
}
