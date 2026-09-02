"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Lock, AlertTriangle } from "lucide-react";

interface ConfermaChiusura {
  direction: string;
  entry: number;
  minutiAperto: number;
  risultatoR: number | null;
  prezzoCorrente: number | null;
}

// Caso distinto: un segnale ancora IN ATTESA non e' un trade, quindi non ha
// minuti-di-vita ne' un risultato in R da mostrare. Solo direzione ed entry.
interface ConfermaAttesa {
  direction: string;
  entry: number;
}

export function GenerateSignalButton({
  endpoint = "/api/generate",
  label = "Genera segnale ora",
}: {
  endpoint?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Quando c'e' un trade aperto il primo click non genera: chiede conferma,
  // mostrando cosa si sta per chiudere e a quanto sta in questo momento.
  const [conferma, setConferma] = useState<ConfermaChiusura | null>(null);
  const [confermaAttesa, setConfermaAttesa] = useState<ConfermaAttesa | null>(null);
  const router = useRouter();

  async function genera(confermaChiusura: boolean) {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confermaChiusura }),
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error ?? "Errore durante la generazione.");
      } else if (data.skipped && data.reason === "conferma_richiesta") {
        setConfermaAttesa(null);
        setConferma({
          direction: data.direction,
          entry: data.entry,
          minutiAperto: data.minutiAperto,
          risultatoR: data.risultatoR ?? null,
          prezzoCorrente: data.prezzoCorrente ?? null,
        });
      } else if (data.skipped && data.reason === "conferma_richiesta_attesa") {
        setConferma(null);
        setConfermaAttesa({ direction: data.direction, entry: data.entry });
      } else if (data.skipped && data.reason === "market_closed") {
        setConferma(null);
        setInfo("Mercato dell'oro chiuso in questo momento (weekend o pausa giornaliera delle 23:00).");
      } else if (data.skipped && data.reason === "signal_active") {
        setConferma(null);
        setInfo(
          `Segnale ${data.direction} gia' attivo (entry ${data.entry}) — nessun nuovo segnale finche' non si chiude.`
        );
      } else if (data.skipped && data.reason === "signal_pending") {
        setConferma(null);
        setConfermaAttesa(null);
        setInfo(
          "Un segnale e' gia' in attesa che il prezzo tocchi l'entry — nessun nuovo segnale finche' non si attiva o scade."
        );
      } else if (data.skipped && data.reason === "ai_paused") {
        setConferma(null);
        setInfo("Analisi AI in pausa. Riattivala dal pulsante in alto per generare un nuovo segnale.");
      } else {
        setConferma(null);
        setConfermaAttesa(null);
        router.refresh();
      }
    } catch {
      setError("Errore di rete. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  if (conferma) {
    const r = conferma.risultatoR;
    const inProfitto = r !== null && r > 0;

    return (
      <div className="rounded-lg border border-gold/40 bg-gold/10 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-gold shrink-0" />
          <span className="text-xs font-semibold text-gold leading-none">
            C&apos;e&apos; un trade aperto
          </span>
        </div>

        <p className="text-[11px] text-muted mt-2 leading-snug">
          {conferma.direction} da {conferma.entry.toFixed(2)}, aperto da {conferma.minutiAperto}{" "}
          minuti
          {conferma.prezzoCorrente !== null ? ` · prezzo ora ${conferma.prezzoCorrente.toFixed(2)}` : ""}
          {r !== null ? (
            <>
              {" · risultato attuale "}
              <span className={inProfitto ? "text-buy font-semibold" : "text-sell font-semibold"}>
                {r > 0 ? "+" : ""}
                {r.toFixed(2)}R
              </span>
            </>
          ) : null}
          .
        </p>

        <p className="text-[11px] text-muted mt-1.5 leading-snug">
          Generare un nuovo segnale lo chiude adesso, a questo risultato. Se non ha ancora
          toccato ne&apos; stop ne&apos; target, conviene lasciarlo lavorare.
        </p>

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setConferma(null)}
            disabled={loading}
            className="flex-1 rounded-lg border border-border bg-panel2 text-text text-xs font-semibold py-2 hover:bg-panel transition-colors disabled:opacity-60"
          >
            Lascialo aperto
          </button>
          <button
            onClick={() => genera(true)}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-sell/40 bg-sell/15 text-sell text-xs font-semibold py-2 hover:bg-sell/25 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            Chiudi e rigenera
          </button>
        </div>
      </div>
    );
  }

  if (confermaAttesa) {
    return (
      <div className="rounded-lg border border-gold/40 bg-gold/10 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-gold shrink-0" />
          <span className="text-xs font-semibold text-gold leading-none">
            C&apos;e&apos; un segnale in attesa
          </span>
        </div>

        <p className="text-[11px] text-muted mt-2 leading-snug">
          {confermaAttesa.direction} con limite a {confermaAttesa.entry.toFixed(2)}, il prezzo non
          l&apos;ha ancora raggiunto: non e&apos; mai stato un trade, non c&apos;e&apos; nessun
          risultato da perdere.
        </p>

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setConfermaAttesa(null)}
            disabled={loading}
            className="flex-1 rounded-lg border border-border bg-panel2 text-text text-xs font-semibold py-2 hover:bg-panel transition-colors disabled:opacity-60"
          >
            Lascialo in attesa
          </button>
          <button
            onClick={() => genera(true)}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-sell/40 bg-sell/15 text-sell text-xs font-semibold py-2 hover:bg-sell/25 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            Sostituiscilo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => genera(false)}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gold hover:bg-gold/90 disabled:opacity-60 disabled:cursor-not-allowed text-black text-sm font-semibold py-2.5 transition-colors"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {loading ? "Analisi in corso..." : label}
      </button>
      {error && <p className="text-xs text-sell mt-2">{error}</p>}
      {info && (
        <p className="text-xs text-gold mt-2 flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" />
          {info}
        </p>
      )}
    </div>
  );
}
