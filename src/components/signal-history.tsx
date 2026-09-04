"use client";

import { useMemo, useState } from "react";
import { TradeSignal } from "@/lib/types";
import { formatRecency } from "@/lib/formatTime";

const DIRECTION_FILTERS = ["Trade", "BUY", "SELL", "NO TRADE"] as const;

function outcomeColor(outcome?: TradeSignal["outcome"]) {
  if (outcome === "WIN") return "text-buy";
  if (outcome === "LOSS") return "text-sell";
  return "text-muted";
}

function directionColor(direction: TradeSignal["direction"]) {
  if (direction === "BUY") return "text-buy";
  if (direction === "SELL") return "text-sell";
  return "text-muted";
}

function directionLabel(direction: TradeSignal["direction"]) {
  return direction === "NO_TRADE" ? "NO TRADE" : direction;
}

export function SignalHistory({
  signals,
  compact = false,
}: {
  signals: TradeSignal[];
  compact?: boolean;
}) {
  const [filter, setFilter] = useState<(typeof DIRECTION_FILTERS)[number]>("Trade");

  const filtered = useMemo(() => {
    if (filter === "Trade") return signals.filter((s) => s.direction === "BUY" || s.direction === "SELL");
    if (filter === "NO TRADE") return signals.filter((s) => s.direction === "NO_TRADE");
    return signals.filter((s) => s.direction === filter);
  }, [signals, filter]);

  return (
    <div className="desk-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="desk-kicker">Storico segnali</span>
        <div className="desk-seg">
          {DIRECTION_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`desk-seg-btn ${filter === f ? "desk-seg-on" : "desk-seg-off"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-panel2 py-8 text-center text-sm text-muted">
          Nessun segnale in questa categoria.
        </div>
      ) : (
        <div>
          <div className={`${compact ? "" : "sm:hidden "}space-y-2 max-h-[420px] overflow-y-auto`}>
            {filtered.map((s) => (
              <div key={s.id} className="rounded-lg border border-border bg-panel2 px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-sm font-semibold ${directionColor(s.direction)}`}>
                    {directionLabel(s.direction)}
                  </span>
                  <span className="font-mono text-[10px] text-muted">{formatRecency(s.createdAt)}</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted">Entry</div>
                    <div className="font-mono text-xs text-text">{s.entry.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted">Esito</div>
                    <div className={`font-mono text-xs font-medium ${outcomeColor(s.outcome)}`}>
                      {s.outcome ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted">R</div>
                    <div className="font-mono text-xs text-text">
                      {s.resultR !== undefined ? s.resultR.toFixed(1) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted">Conf.</div>
                    <div className="font-mono text-xs text-gold">{s.confidence}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className={`${compact ? "hidden" : "hidden sm:block"} overflow-auto max-h-[420px] rounded-lg`}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Quando</th>
                  <th className="py-2 pr-4 font-medium">Direzione</th>
                  <th className="py-2 pr-4 font-medium">Entry</th>
                  <th className="py-2 pr-4 font-medium">Esito</th>
                  <th className="py-2 pr-4 font-medium">R</th>
                  <th className="py-2 pr-4 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-text whitespace-nowrap">
                      {formatRecency(s.createdAt)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`font-medium ${directionColor(s.direction)}`}>{directionLabel(s.direction)}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-text">{s.entry.toFixed(2)}</td>
                    <td className={`py-2.5 pr-4 font-medium ${outcomeColor(s.outcome)}`}>{s.outcome ?? "—"}</td>
                    <td className="py-2.5 pr-4 font-mono text-text">
                      {s.resultR !== undefined ? s.resultR.toFixed(1) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-gold">{s.confidence}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {signals.some((s) => s.isDemo) && (
            <p className="text-[10px] text-muted mt-3">
              I dati contrassegnati come demo sono di esempio e non provengono da trading reale.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
