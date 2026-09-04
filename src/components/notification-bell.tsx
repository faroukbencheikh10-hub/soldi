"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import {
  getNotificationPermission,
  isPushSupported,
  getExistingPushSubscription,
  subscribeToPush,
} from "@/lib/notifications";

type Status = "granted" | "denied" | "default" | "unsupported" | "loading";

export function NotificationBell() {
  const [status, setStatus] = useState<Status>("default");
  const [open, setOpen] = useState(true);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "empty" | "error">("idle");
  const [testDetail, setTestDetail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!isPushSupported()) {
        setStatus("unsupported");
        return;
      }
      const permission = getNotificationPermission();
      if (permission === "denied") {
        setStatus("denied");
        return;
      }
      if (permission === "granted") {
        setStatus("granted");
        return;
      }
      const existing = await getExistingPushSubscription().catch(() => null);
      setStatus(existing ? "granted" : "default");
    })();
  }, []);

  async function handleEnable() {
    setStatus("loading");
    setErrorHint(null);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        setStatus("granted");
        setOpen(true);
      } else if (result.reason === "denied") {
        setStatus("denied");
      } else {
        setStatus("default");
        setErrorHint("Attivazione non riuscita. Riprova.");
      }
    } catch {
      setStatus("default");
      setErrorHint("Attivazione non riuscita. Riprova.");
    }
  }

  async function handleTestPush() {
    setTestState("sending");
    setTestDetail(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (data?.ok && data.sent > 0) setTestState("sent");
      else if (data?.ok) {
        setTestState("empty");
        setTestDetail(
          data.subscriptions === 0
            ? "Nessun dispositivo registrato. Riattiva le notifiche da questo telefono."
            : "Invio a 0. Controlla le chiavi VAPID."
        );
      } else {
        setTestState("error");
        setTestDetail(data?.error || "Invio non riuscito.");
      }
    } catch {
      setTestState("error");
      setTestDetail("Errore di rete.");
    }
  }

  const Icon = status === "granted" ? BellRing : status === "denied" ? BellOff : Bell;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifiche"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-panel2 text-muted hover:text-gold hover:border-gold/40"
      >
        <Icon size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-panel p-4 shadow-xl z-50">
          <p className="text-sm font-medium text-text mb-1">Notifiche nuovi segnali</p>
          <p className="text-xs text-muted mb-3">Avviso sul telefono quando parte un BUY o un SELL.</p>

          {status === "granted" && (
            <>
              <p className="text-xs font-medium text-buy mb-2">Notifiche attive</p>
              <button
                type="button"
                onClick={handleTestPush}
                disabled={testState === "sending"}
                className="w-full rounded-lg bg-gold text-black text-xs font-semibold py-2.5 disabled:opacity-60"
              >
                {testState === "sending" ? "Invio in corso…" : "Invia notifica di prova"}
              </button>
              {testState === "sent" && (
                <p className="text-xs text-buy mt-2">Inviata — controlla il telefono.</p>
              )}
              {testState === "empty" && <p className="text-xs text-sell mt-2">{testDetail}</p>}
              {testState === "error" && (
                <p className="text-xs text-sell mt-2">{testDetail ?? "Invio non riuscito."}</p>
              )}
            </>
          )}

          {status === "denied" && (
            <p className="text-xs text-sell">Permesso negato — abilitalo dalle impostazioni del browser.</p>
          )}
          {status === "loading" && <p className="text-xs text-muted">Attivazione in corso…</p>}
          {status === "default" && (
            <>
              <button
                type="button"
                onClick={handleEnable}
                className="w-full rounded-lg bg-gold text-black text-xs font-semibold py-2"
              >
                Attiva notifiche
              </button>
              {errorHint && <p className="text-xs text-sell mt-2">{errorHint}</p>}
            </>
          )}
          {status === "unsupported" && (
            <p className="text-xs text-muted">Il tuo browser non supporta le notifiche push.</p>
          )}
        </div>
      )}
    </div>
  );
}
