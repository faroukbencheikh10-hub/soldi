import { TradeSignal } from "@/lib/types";
import { TrendingUp, TrendingDown, CircleSlash, ShieldAlert } from "lucide-react";
import { formatRecency } from "@/lib/formatTime";

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

export function SignalPanel({ signal }: { signal: TradeSignal | null }) {
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

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Metric label="Entry" value={signal.entry.toFixed(2)} />
        <Metric label="Stop Loss" value={signal.stopLoss.toFixed(2)} />
        <Metric label="R:R" value={signal.riskReward.toFixed(1)} />
        <Metric label="TP1" value={signal.tp1.toFixed(2)} />
        <Metric label="TP2" value={signal.tp2.toFixed(2)} />
        <Metric label="Esito" value={signal.outcome ?? "—"} />
        {signal.stopLossTp2 !== null && signal.stopLossTp2 !== undefined && (
          <Metric label="SL dopo TP1" value={signal.stopLossTp2.toFixed(2)} />
        )}
      </div>

      <div className="rounded-lg bg-panel2 border border-border px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted mb-1">Spiegazione</div>
        <p className="text-xs text-text leading-relaxed">{signal.reasoning}</p>
      </div>
    </div>
  );
}
