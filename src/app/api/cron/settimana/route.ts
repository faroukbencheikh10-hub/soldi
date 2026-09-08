import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runSettimana } from "@/lib/server/settimana/runSettimana";
import { isWeekendUtc } from "@/lib/server/settimana/week";

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

  const now = new Date();
  if (isWeekendUtc(now)) {
    return NextResponse.json({ ok: true, skipped: "weekend_utc" });
  }

  waitUntil(
    runSettimana(now).catch((err) => {
      console.error("[cron/settimana]", err);
    })
  );

  return NextResponse.json({
    ok: true,
    accepted: true,
    at: now.toISOString(),
  });
}
