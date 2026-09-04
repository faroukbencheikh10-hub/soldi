"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";

export function ChiamateToggle() {
  const [attive, setAttive] = useState<boolean | null>(null);
  const [configurato, setConfigurato] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/chiamate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAttive(Boolean(d?.attive));
        setConfigurato(d?.configurato !== false);
      })
      .catch(() => {
        // Fallito il caricamento iniziale: non si sa se Twilio e'
        // configurato, quindi si fallisce "chiuso" (non configurato)
        // invece di mostrare un interruttore cliccabile ma di stato ignoto.
        setAttive(false);
        setConfigurato(false);
      });
  }, []);

  async function toggle() {
    if (attive === null || busy || !configurato) return;
    setBusy(true);
    const next = !attive;
    try {
      const res = await fetch("/api/settings/chiamate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attive: next }),
      });
      const data = await res.json();
      if (data?.ok) setAttive(Boolean(data.attive));
    } catch {
      // silenzioso: il pulsante torna cliccabile, si puo' riprovare
    } finally {
      setBusy(false);
    }
  }

  if (attive === null) {
    return (
      <div className="rounded-lg border border-border bg-panel2 px-3 py-2.5 flex items-center justify-center">
        <Loader2 size={14} className="animate-spin text-muted" />
      </div>
    );
  }

  // Le credenziali Twilio mancano su Vercel: l'interruttore non ha senso di
  // essere premuto, quindi si spiega perche' invece di lasciarlo cliccabile
  // e senza effetto.
  if (!configurato) {
    return (
      <div className="rounded-lg border border-border bg-panel2 px-3 py-2.5 flex items-center gap-2">
        <PhoneOff size={14} className="text-muted shrink-0" />
        <span className="text-[11px] text-muted leading-snug">
          Chiamate vocali non configurate (mancano le credenziali Twilio)
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`desk-btn ${
        attive ? "desk-btn-buy" : "desk-btn-ghost"
      }`}
    >
      {busy ? (
        <Loader2 size={16} className="animate-spin" />
      ) : attive ? (
        <Phone size={16} />
      ) : (
        <PhoneOff size={16} />
      )}
      {attive ? "Chiamate vocali attive" : "Attiva chiamata sui nuovi segnali"}
    </button>
  );
}
