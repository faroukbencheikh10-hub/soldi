import { TradeSignal } from "@/lib/types";
import { TrendingUp, TrendingDown, CircleSlash, ShieldAlert, Hourglass, Target, XCircle } from "lucide-react";
import { formatRecency } from "@/lib/formatTime";

// L'entry di un segnale e' il bordo della zona di pullback: un ordine
// PENDENTE, non un "entra adesso". Questo riquadro lo dice esplicitamente e
// mostra quanto dista dal prezzo, perche' entrare a mercato alla notifica
// significa prendere il lato sbagliato dell'impulso e bruciare gran parte
// dello stop prima che il trade parta.
const INGRESSO_SUPERATO_ATR = 1;

function StatoIngresso({
  signal,
  prezzoCorrente,
  atr,
}: {
  signal: TradeSignal;
  prezzoCorrente: number | null;
  atr: number | null;
}) {
  if (signal.direction === "NO_TRADE" || signal.outcome) return null;
  if (prezzoCorrente === null || !Number.isFinite(prezzoCorrente)) return null;

  const entry = signal.entry;
  const distanza = Math.abs(entry - prezzoCorrente);
  const distanzaInAtr = atr !== null && atr > 0 ? distanza / atr : null;
  const raggiunto = signal.direction === "BUY" ? prezzoCorrente <= entry : prezzoCorrente >= entry;
  const superato = !raggiunto && distanzaInAtr !== null && distanzaInAtr > INGRESSO_SUPERATO_ATR;

  const dettaglio = `prezzo ${prezzoCorrente.toFixed(2)} · ${distanza.toFixed(2)} di distanza${
    distanzaInAtr !== null ? ` (${distanzaInAtr.toFixed(2)} ATR)` : ""
  }`;

  if (raggiunto) {
    return (
      <div className="mb-3 rounded-lg border border-buy/30 bg-buy/10 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-buy shrink-0" />
          <span className="text-xs font-semibold text-buy leading-none">Eseguibile ora</span>
        </div>
        <p className="text-[11px] text-muted mt-1.5 leading-snug">
          Il prezzo ha raggiunto la zona di ingresso — {dettaglio}.
        </p>
      </div>
    );
  }

  if (superato) {
    return (
      <div className="mb-3 rounded-lg border border-border bg-panel2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <XCircle size={14} className="text-muted shrink-0" />
          <span className="text-xs font-semibold text-muted leading-none">Pullback saltato</span>
        </div>
        <p className="text-[11px] text-muted mt-1.5 leading-snug">
          Il prezzo si e&apos; allontanato dalla zona senza tornarci — {dettaglio}. Inseguire
          qui significa entrare con lo stop gia&apos; quasi consumato.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Hourglass size={14} className="text-gold shrink-0" />
        <span className="text-xs font-semibold text-gold leading-none">
          Ordine pendente a {entry.toFixed(2)}
        </span>
      </div>
      <p className="text-[11px] text-muted mt-1.5 leading-snug">
        Non entrare a mercato: {dettaglio}. Piazza il limite su {entry.toFixed(2)} e aspetta
        che il prezzo torni nella zona.
      </p>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: TradeSignal["direction"] }) {
  if (direction === "BUY")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-buy/15 text-buy px-3 py-1.5 text-sm font-semibold">
        <TrendingUp size={16} /> BUY
      </span>
    );
  if (direction === "SELL")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-sell/15 text-sell px-3 py-1.5 text-sm font-semibold">
        <TrendingDown size={16} /> SELL
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-panel2 text-muted px-3 py-1.5 text-sm font-semibold">
      <CircleSlash size={16} /> NO TRADE
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-mono text-sm text-text mt-0.5">{value}</div>
    </div>
  );
}

export function SignalPanel({
  signal,
  prezzoCorrente = null,
  atr = null,
}: {
  signal: TradeSignal | null;
  prezzoCorrente?: number | null;
  atr?: number | null;
}) {
  if (!signal) {
    return (
      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={16} className="text-muted" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Segnale corrente</span>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-panel2 py-8 text-center">
          <p className="text-sm text-text font-medium">Agente non ancora collegato</p>
          <p className="text-xs text-muted mt-1 px-4">
            Nessun segnale live disponibile: connetti le fonti dati per iniziare l&apos;analisi.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Segnale corrente</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted">{formatRecency(signal.createdAt)}</span>
          {signal.isDemo && (
            <span className="rounded-full bg-gold/15 text-gold px-2 py-0.5 text-[10px] font-semibold uppercase">
              Demo
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <DirectionBadge direction={signal.direction} />
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted">Confidence</div>
          <div className="font-mono text-lg font-semibold text-gold">{signal.confidence}%</div>
        </div>
      </div>

      <StatoIngresso signal={signal} prezzoCorrente={prezzoCorrente} atr={atr} />

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Metric label="Entry" value={signal.entry.toFixed(2)} />
        <Metric label="Stop Loss" value={signal.stopLoss.toFixed(2)} />
        <Metric label="R:R" value={signal.riskReward.toFixed(1)} />
        <Metric label="TP1" value={signal.tp1.toFixed(2)} />
        <Metric label="TP2" value={signal.tp2.toFixed(2)} />
        <Metric label="Esito" value={signal.outcome ?? "—"} />
      </div>

      <div className="rounded-lg bg-panel2 border border-border px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted mb-1">Spiegazione</div>
        <p className="text-xs text-text leading-relaxed">{signal.reasoning}</p>
      </div>
    </div>
  );
}
