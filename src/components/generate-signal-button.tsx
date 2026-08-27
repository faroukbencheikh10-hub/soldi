"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Lock } from "lucide-react";

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
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Errore durante la generazione.");
      } else if (data.skipped && data.reason === "market_closed") {
        setInfo("Mercato dell'oro chiuso in questo momento (weekend o pausa giornaliera delle 23:00).");
      } else if (data.skipped && data.reason === "signal_active") {
        setInfo(
          `Segnale ${data.direction} gia' attivo (entry ${data.entry}) — nessun nuovo segnale finche' non si chiude.`
        );
      } else if (data.skipped && data.reason === "ai_paused") {
        setInfo("Analisi AI in pausa. Riattivala dal pulsante in alto per generare un nuovo segnale.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Errore di rete. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
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
