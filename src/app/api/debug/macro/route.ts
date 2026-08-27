import { NextResponse } from "next/server";
import { getMacroContext } from "@/lib/server/macroData";
import { isMarketOpen } from "@/lib/server/marketData";
import { getRelevantNews, diagnoseFeeds } from "@/lib/server/news";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const inizio = Date.now();
    const [macro, news, perFeed] = await Promise.all([
      getMacroContext(),
      getRelevantNews(),
      diagnoseFeeds(),
    ]);
    const durataMs = Date.now() - inizio;

    const asia = news.filter((n) => n.area === "asia");
    const globali = news.filter((n) => n.area !== "asia");
    const now = new Date();

    return NextResponse.json({
      ok: true,
      orari: {
        adesso: now.toISOString(),
        mercatoAperto: isMarketOpen(now),
        dom_18NY_deveEsserAperto: isMarketOpen(new Date("2026-08-23T22:00:00Z")),
        mar_17NY_pausa_deveEsserChiuso: isMarketOpen(new Date("2026-08-25T21:00:00Z")),
        ven_17NY_deveEsserChiuso: isMarketOpen(new Date("2026-08-21T21:00:00Z")),
      },
      news: {
        durataRecuperoMs: durataMs,
        totale: news.length,
        asia: asia.length,
        globali: globali.length,
        titoliAsia: asia.slice(0, 5).map((n) => n.title),
      },
      perFeed,
      macro,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
