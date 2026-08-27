"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Loader2 } from "lucide-react";

export function AiPauseToggle() {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-pause", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPaused(Boolean(d?.paused)))
      .catch(() => setPaused(false));
  }, []);

  async function toggle() {
    if (paused === null || busy) return;
    setBusy(true);
    const next = !paused;
    try {
      const res = await fetch("/api/settings/ai-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      const data = await res.json();
      if (data?.ok) setPaused(Boolean(data.paused));
    } catch {
      // silenzioso: il pulsante torna cliccabile, l'utente puo' riprovare
    } finally {
      setBusy(false);
    }
  }

  if (paused === null) {
    return (
      <div className="rounded-lg border border-border bg-panel2 px-3 py-2.5 flex items-center justify-center">
        <Loader2 size={14} className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={toggle}
        disabled={busy}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed border ${
          paused
            ? "bg-sell/15 text-sell border-sell/30 hover:bg-sell/25"
            : "bg-panel2 text-muted border-border hover:text-text"
        }`}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : paused ? (
          <Play size={16} />
        ) : (
          <Pause size={16} />
        )}
        {paused ? "Modalita sonno attiva — riprendi" : "Modalita sonno"}
      </button>
      {paused && (
        <p className="text-[10px] text-muted mt-1.5 text-center">
          AI, analisi e notifiche restano ferme finche non premi riprendi. Il grafico TradingView resta indipendente.
        </p>
      )}
    </div>
  );
}
