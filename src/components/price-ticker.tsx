"use client";

import { useEffect, useState } from "react";
import { MarketQuote } from "@/lib/types";
import { DataStatusBadge } from "./data-status-badge";

function ageColor(ageMinutes: number): string {
  if (ageMinutes < 2) return "text-buy";
  if (ageMinutes < 5) return "text-gold";
  return "text-sell";
}

function formatAge(ageMinutes: number): string {
  if (ageMinutes < 1) return "ora";
  return `${Math.round(ageMinutes)} min fa`;
}

// 60s invece di 20s: lo snapshot viene riscritto dal cron, non cambia
// piu' spesso di cosi'. Chiamare ogni 20s significava rileggere tre volte
// lo stesso valore e tenere sveglio il database per niente.
const REFRESH_MS = 60_000;
const STALE_MINUTES = 20;

export function PriceTicker({ quote: initialQuote }: { quote: MarketQuote }) {
  const [quote, setQuote] = useState(initialQuote);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        // /api/ticker restituisce solo prezzo, variazione e orari: poche
        // decine di byte, invece delle centinaia di KB di /api/state.
        const res = await fetch("/api/ticker", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data?.ok) return;

        const ageMinutes = data.quotatoIl ? (Date.now() - Number(data.quotatoIl)) / 60000 : null;
        const snapshotAgeMinutes = data.snapshotCreatoIl
          ? (Date.now() - new Date(data.snapshotCreatoIl).getTime()) / 60000
          : null;
        const isStale = snapshotAgeMinutes !== null && snapshotAgeMinutes > STALE_MINUTES;

        if (!cancelled) {
          setQuote((prev) => ({
            ...prev,
            price: !isStale && data.prezzo !== null ? Number(data.prezzo) : prev.price,
            changePercent:
              !isStale && data.variazionePct !== null ? Number(data.variazionePct) : prev.changePercent,
            status: isStale ? "disconnected" : "live",
            ageMinutes,
          }));
        }
      } catch {
        // silenzioso: riprova al prossimo giro, non degrada il valore gia' mostrato
      }
    }

    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex items-center gap-3">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted">{quote.label}</div>
        <div className="font-mono text-xl font-semibold text-text">
          {quote.price !== null ? quote.price.toFixed(2) : "—"}
        </div>
        {quote.ageMinutes !== null && quote.ageMinutes !== undefined && (
          <div className={`font-mono text-[10px] ${ageColor(quote.ageMinutes)}`}>
            aggiornato {formatAge(quote.ageMinutes)}
          </div>
        )}
      </div>
      <DataStatusBadge status={quote.status} />
    </div>
  );
}
