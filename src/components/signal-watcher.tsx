"use client";

import { useEffect, useRef } from "react";
import { notifyNewSignal } from "@/lib/notifications";

const POLL_INTERVAL_MS = 60_000;
const STORAGE_KEY = "soldi:lastSeenSignalId";

export function SignalWatcher() {
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    lastSeenRef.current = window.localStorage.getItem(STORAGE_KEY);

    function checkAndNotify(
      latest: { id: string; direction: string; entry: number; confidence: number } | undefined,
      ref: React.MutableRefObject<string | null>,
      storageKey: string,
      label: string
    ) {
      if (!latest) return;
      const isNew = latest.id !== ref.current;
      const isActionable = latest.direction === "BUY" || latest.direction === "SELL";

      if (isNew && isActionable && ref.current !== null) {
        notifyNewSignal(label, `Entry ${latest.entry} · Confidence ${latest.confidence}%`);
      }

      if (isNew) {
        ref.current = latest.id;
        window.localStorage.setItem(storageKey, latest.id);
      }
    }

    async function poll() {
      try {
        // /api/ticker porta solo l'ultimo segnale di ogni canale: prima qui
        // si scaricavano 150 righe di storico per leggerne due.
        const res = await fetch("/api/ticker", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        checkAndNotify(
          data?.ultimoSegnale,
          lastSeenRef,
          STORAGE_KEY,
          `Nuovo segnale: ${data?.ultimoSegnale?.direction}`
        );
      } catch {
        // silenzioso: riprova al prossimo giro
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
