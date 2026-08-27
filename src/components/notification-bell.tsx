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
  const [open, setOpen] = useState(false);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "empty" | "error">(
    "idle"
  );

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
      } else if (result.reason === "denied") {
        setStatus("denied");
      } else {
        setStatus("default");
        if (result.reason === "subscribe_failed" || result.reason === "server_error") {
          setErrorHint("Attivazione non riuscita. Riprova tra qualche secondo.");
        }
      }
    } catch {
      setStatus("default");
      setErrorHint("Attivazione non riuscita. Riprova tra qualche secondo.");
    }
  }

  async function handleTestPush() {
    setTestState("sending");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (data?.ok && data.sent > 0) {
        setTestState("sent");
      } else if (data?.ok) {
        setTestState("empty");
      } else {
        setTestState("error");
      }
    } catch {
      setTestState("error");
    }
  }

  const Icon = status === "granted" ? BellRing : status === "denied" ? BellOff : Bell;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifiche nuovi segnali"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-panel2 text-muted hover:text-gold hover:border-gold/40 transition-colors"
      >
        <Icon size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-panel p-4 shadow-xl shadow-black/40 z-50">
          <p className="text-sm font-medium text-text mb-1">Notifiche nuovi segnali</p>
          <p className="text-xs text-muted mb-3">
            Ricevi un avviso push ogni volta che l&apos;agente genera un nuovo segnale valido — anche ad
            app chiusa.
          </p>
          {status === "granted" && (
            <>
              <p className="text-xs text-buy mb-2">Notifiche attive</p>
              <button
                onClick={handleTestPush}
                disabled={testState === "sending"}
                className="w-full rounded-lg bg-panel2 border border-border hover:border-gold/40 hover:text-gold text-muted text-xs font-medium py-2 transition-colors disabled:opacity-60"
              >
                {testState === "sending" ? "Invio in corso…" : "Invia notifica di prova"}
              </button>
              {testState === "sent" && (
                <p className="text-xs text-buy mt-2">
                  Inviata — controlla che sia arrivata sul telefono.
                </p>
              )}
              {testState === "empty" && (
                <p className="text-xs text-sell mt-2">
                  Nessun dispositivo registrato sul server. Prova a disattivare e riattivare le
                  notifiche.
                </p>
              )}
              {testState === "error" && (
                <p className="text-xs text-sell mt-2">Invio non riuscito. Riprova tra poco.</p>
              )}
            </>
          )}
          {status === "denied" && (
            <p className="text-xs text-sell">Permesso negato — abilitalo dalle impostazioni del browser</p>
          )}
          {status === "loading" && <p className="text-xs text-muted">Attivazione in corso…</p>}
          {status === "default" && (
            <>
              <button
                onClick={handleEnable}
                className="w-full rounded-lg bg-gold/90 hover:bg-gold text-black text-xs font-semibold py-2 transition-colors"
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
