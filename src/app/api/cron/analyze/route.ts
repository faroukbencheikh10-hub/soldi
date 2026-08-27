import { NextRequest, NextResponse } from "next/server";
import { runAnalysis, runAnalysis30m } from "@/lib/server/runAnalysis";
import { getMarketSnapshot, isMarketOpen } from "@/lib/server/marketData";

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

  try {
    if (!isMarketOpen()) {
      return NextResponse.json({ ok: true, skipped: true, reason: "market_closed" });
    }

    // Un solo snapshot alimenta entrambi i canali: nessun raddoppio delle
    // chiamate a MetaApi/Twelve Data.
    const marketSnapshot = await getMarketSnapshot();
    const oro = await runAnalysis({ marketSnapshot }).catch((err) => {
      console.error("[cron/analyze] errore canale principale:", err);
      return {
        channelError: true,
        error: err instanceof Error ? err.message : "Errore sconosciuto",
      };
    });
    const m30 = await runAnalysis30m({ marketSnapshot }).catch((err) => {
      console.error("[cron/analyze] errore canale M30:", err);
      return {
        channelError: true,
        error: err instanceof Error ? err.message : "Errore sconosciuto",
      };
    });

    // I campi storici del canale principale restano al primo livello per non
    // rompere chi gia' legge questa route; il nuovo canale e' sotto "m30".
    const entrambiFalliti = "channelError" in oro && "channelError" in m30;
    return NextResponse.json(
      { ok: !entrambiFalliti, ...oro, m30 },
      { status: entrambiFalliti ? 500 : 200 }
    );
  } catch (err) {
    console.error("[cron/analyze] errore oro:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
