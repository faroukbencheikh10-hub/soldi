"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Loader2, Moon, Activity } from "lucide-react";
import { formatClock, formatRecency } from "@/lib/formatTime";

export function AiPauseToggle() {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-pause", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setPaused(Boolean(d?.paused));
        setPausedAt(d?.pausedAt ?? null);
      })
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
      if (data?.ok) {
        setPaused(Boolean(data.paused));
        setPausedAt(data.pausedAt ?? null);
      }
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
    <div className="space-y-2">
      {/* Stato sempre scritto sulla dashboard, non solo deducibile dal
          pulsante: in pausa dice DA QUANDO e ricorda che il monitor gira
          comunque; attivo lo dichiara esplicitamente. */}
      {paused ? (
        <div className="rounded-lg border border-sell/30 bg-sell/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Moon size={14} className="text-sell shrink-0" />
            <span className="text-sm font-semibold text-sell leading-none">
              Modalita&apos; sonno attiva
            </span>
          </div>
          <p className="text-[11px] text-muted mt-1.5 leading-snug">
            Analisi AI ferma dalle {formatClock(pausedAt)}
            {pausedAt ? ` (${formatRecency(pausedAt)})` : ""}. Nessun segnale
            nuovo finche&apos; non la riattivi.
          </p>
          <p className="text-[11px] text-muted mt-1 leading-snug">
            Il monitor continua: candele chiuse, eventi di struttura e contesto
            restano aggiornati, e al risveglio l&apos;analisi riparte da un
            quadro completo.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-panel2 px-3 py-2 flex items-center gap-2">
          <Activity size={14} className="text-buy shrink-0" />
          <span className="text-[11px] text-muted leading-none">
            Analisi AI attiva — segnali generati normalmente
          </span>
        </div>
      )}

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
        {paused ? "Riprendi l'analisi AI" : "Metti in pausa l'analisi AI"}
      </button>
    </div>
  );
}
