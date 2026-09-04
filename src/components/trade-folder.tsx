import { TradeSignal } from "@/lib/types";
import { formatRecency } from "@/lib/formatTime";
import { TrendingUp, TrendingDown, CircleSlash } from "lucide-react";

function Riga({ signal }: { signal: TradeSignal }) {
  const noTrade = signal.direction === "NO_TRADE";
  const vivo = !noTrade && Boolean(signal.attivatoIl);
  const buy = signal.direction === "BUY";

  return (
    <div className="rounded-lg border border-border bg-panel2 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
            noTrade ? "text-muted" : buy ? "text-buy" : "text-sell"
          }`}
        >
          {noTrade ? <CircleSlash size={15} /> : buy ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
          {noTrade ? "NO TRADE" : signal.direction}
        </span>
        <span className="font-mono text-[10px] text-muted">{formatRecency(signal.createdAt)}</span>
      </div>
      {!noTrade && (
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
      )}
      <p className="text-[11px] text-muted mt-2 leading-snug">
        {noTrade
          ? signal.reasoning
          : vivo
            ? "Trade vivo: il prezzo ha validato l'entry. Stop e target sono in monitoraggio."
            : "Segnale nato, in attesa che il prezzo tocchi l'entry."}
      </p>
    </div>
  );
}

export function TradeFolder({ trades }: { trades: TradeSignal[] }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4 sm:p-5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Cartella trade</span>
      {trades.length === 0 ? (
        <p className="text-sm text-muted mt-3">Nessun segnale ancora.</p>
      ) : (
        <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
          {trades.map((t) => (
            <Riga key={t.id} signal={t} />
          ))}
        </div>
      )}
    </div>
  );
}
