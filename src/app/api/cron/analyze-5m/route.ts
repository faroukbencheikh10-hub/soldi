import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === secret || querySecret === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "auto_disabled",
    note: "Canale veloce: esecuzione automatica disattivata, usa solo il pulsante manuale.",
  });
}
