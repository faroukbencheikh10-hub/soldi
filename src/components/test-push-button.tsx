"use client";

import { useState } from "react";

export function TestPushButton({ variant = "header" }: { variant?: "header" | "block" }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "empty" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setDetail(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (data?.ok && data.sent > 0) {
        setState("sent");
        return;
      }
      if (data?.ok) {
        setState("empty");
        setDetail(
          data.subscriptions === 0
            ? "Prima attiva le notifiche dalla campanella."
            : "Invio a 0. Controlla le chiavi VAPID su Vercel."
        );
        return;
      }
      setState("error");
      setDetail(data?.error || "Invio non riuscito.");
    } catch {
      setState("error");
      setDetail("Errore di rete.");
    }
  }

  const label =
    state === "sending" ? "Invio…" : state === "sent" ? "Inviata" : "Invia notifica di prova";

  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="hidden sm:inline-flex items-center rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text hover:border-gold hover:text-gold disabled:opacity-60"
      >
        {label}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-semibold text-text hover:border-gold disabled:opacity-60"
      >
        {label}
      </button>
      {state === "sent" && <p className="text-xs text-buy mt-2">Controlla il telefono.</p>}
      {(state === "empty" || state === "error") && (
        <p className="text-xs text-sell mt-2">{detail}</p>
      )}
    </div>
  );
}
