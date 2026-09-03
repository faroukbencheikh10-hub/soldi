"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Strategia = "normale" | "veloce";

const OPZIONI: { valore: Strategia; etichetta: string; nota: string }[] = [
  { valore: "normale", etichetta: "Normale", nota: "setup M15, trade fino a 4 ore" },
  { valore: "veloce", etichetta: "Veloce", nota: "trade da 10-30 minuti" },
];

export function StrategiaToggle() {
  const [attiva, setAttiva] = useState<Strategia | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/strategia", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAttiva((d?.strategia as Strategia) ?? "normale"))
      .catch(() => setAttiva("normale"));
  }, []);

  async function scegli(s: Strategia) {
    if (busy || s === attiva) return;
    setBusy(true);
    // Aggiornamento ottimistico: il pulsante risponde subito, e se la
    // scrittura fallisce si torna al valore che c'era.
    const precedente = attiva;
    setAttiva(s);
    try {
      const res = await fetch("/api/settings/strategia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategia: s }),
      });
      const data = await res.json();
      if (!data?.ok) setAttiva(precedente);
    } catch {
      setAttiva(precedente);
    } finally {
      setBusy(false);
    }
  }

  if (attiva === null) {
    return (
      <div className="rounded-lg border border-border bg-panel2 px-3 py-2.5 flex items-center justify-center">
        <Loader2 size={14} className="animate-spin text-muted" />
      </div>
    );
  }

  const nota = OPZIONI.find((o) => o.valore === attiva)?.nota ?? "";

  return (
    <div className="rounded-lg border border-border bg-panel2 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted px-1 mb-2">Strategia</div>
      <div className="grid grid-cols-2 gap-1.5">
        {OPZIONI.map((o) => (
          <button
            key={o.valore}
            onClick={() => scegli(o.valore)}
            disabled={busy}
            className={`rounded-md text-xs font-semibold py-2 transition-colors disabled:opacity-60 border ${
              attiva === o.valore
                ? "bg-gold/15 text-gold border-gold/40"
                : "bg-panel text-muted border-border hover:text-text"
            }`}
          >
            {o.etichetta}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted mt-2 px-1 leading-snug">{nota}</p>
    </div>
  );
}
