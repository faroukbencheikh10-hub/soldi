import { TradeSignal } from "@/lib/types";
import { formatRecency } from "@/lib/formatTime";
import { TrendingUp, TrendingDown } from "lucide-react";

function Riga({ signal }: { signal: TradeSignal }) {
  const vivo = Boolean(signal.attivatoIl);
  const buy = signal.direction === "BUY";

  return (
    <div className="rounded-lg border border-gold/25 bg-panel2 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
            buy ? "text-buy" : "text-sell"
          }`}
        >
          {buy ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
          {signal.direction}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {vivo ? `attivo ${formatRecency(signal.attivatoIl!)}` : `in attesa ${formatRecency(signal.createdAt)}`}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted">Entry</div>
          <div className="font-mono text-xs text-text">{signal.entry.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted">Stop</div>
          <div className="font-mono text-xs text-text">{signal.stopLoss.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted">TP1</div>
          <div className="font-mono text-xs text-text">{signal.tp1.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted">Conf.</div>
          <div className="font-mono text-xs text-gold">{signal.confidence}%</div>
        </div>
      </div>
      <p className="text-[11px] text-muted mt-2 leading-snug">
        {vivo
          ? "Trade vivo: il prezzo ha validato l'entry. Stop e target sono in monitoraggio."
          : "Segnale nato, in attesa che il prezzo tocchi l'entry."}
      </p>
    </div>
  );
}

export function TradeFolder({ trades }: { trades: TradeSignal[] }) {
  if (trades.length === 0) return null;

  return (
    <div className="rounded-xl border border-gold/30 bg-panel p-4 sm:p-5">
      <span className="text-xs font-medium uppercase tracking-wide text-gold">Cartella trade</span>
      <div className="mt-3 space-y-2">
        {trades.map((t) => (
          <Riga key={t.id} signal={t} />
        ))}
      </div>
    </div>
  );
}
