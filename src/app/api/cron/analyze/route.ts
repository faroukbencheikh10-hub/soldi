import { NextRequest, NextResponse } from "next/server";
import { runAnalysis } from "@/lib/server/runAnalysis";
import { getStrategiaAttiva, getSegnaleAttivo } from "@/lib/server/db";

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

  // Il canale principale si spegne solo se scegli "solo veloce", e nemmeno
  // sempre: vedi l'eccezione sui trade aperti qui sotto.
  //
  // La strategia si legge in modo tollerante: questa chiamata avviene PRIMA
  // di ensureSchema
  // (che sta dentro runAnalysis), quindi su un database nuovo la tabella
  // app_settings potrebbe non esistere ancora e la query fallirebbe. In quel
  // caso si assume "normale", cioe' il comportamento di sempre, e sara'
  // ensureSchema a creare la tabella al primo ciclo utile.
  let strategia: "normale" | "veloce" = "normale";
  try {
    strategia = await getStrategiaAttiva();
  } catch (err) {
    console.error("[cron] lettura strategia fallita, si assume normale:", err);
  }
  if (strategia === "veloce") {
    // ECCEZIONE: con un trade ancora aperto il canale gira lo stesso.
    //
    // Dentro runAnalysis non c'e' solo la generazione di segnali: c'e' anche
    // il monitor che controlla stop, target e scadenza dei trade in corso.
    // Spegnendo il canale con una posizione aperta, quel trade resterebbe
    // appeso -- nessuno lo chiuderebbe piu' finche' non si torna su
    // "normale", e nel frattempo il prezzo puo' aver superato lo stop da un
    // pezzo.
    //
    // Finche' il trade e' vivo il ciclo prosegue: generera' comunque
    // NO_TRADE o si fermera' sul blocco "trade aperto", quindi non produce
    // segnali nuovi, ma continua a sorvegliare quello che c'e'.
    //
    // Anche questa lettura puo' fallire su un database nuovo, per lo stesso
    // motivo. In caso di errore si assume che un trade ci sia: il ciclo
    // prosegue e sorveglia. E' la scelta prudente -- proseguire per niente
    // costa un ciclo, non proseguire con un trade aperto lo lascia senza
    // nessuno che controlli lo stop.
    let aperto: unknown = null;
    try {
      aperto = await getSegnaleAttivo();
    } catch (err) {
      console.error("[cron] lettura trade aperto fallita, il ciclo prosegue:", err);
      aperto = { sconosciuto: true };
    }

    if (!aperto) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "canale_non_attivo",
        note: 'Canale normale non attivo: strategia impostata su "veloce".',
      });
    }
  }

  try {
    const oro = await runAnalysis();
    return NextResponse.json({ ok: true, ...oro });
  } catch (err) {
    console.error("[cron/analyze] errore oro:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
