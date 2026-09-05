"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";

type DailyPnl = {
  pnlEur: number;
  trades: number;
  wins: number;
  losses: number;
  target: number;
  maxLoss: number;
  lotSize: number;
  finished: boolean;
};

function formatEur(n: number): string {
  const abs = Math.abs(n).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n >= 0 ? "+" : "−"}${abs} €`;
}

function formatLots(n: number): string {
  const text = Number.isInteger(n) ? String(n) : String(n);
  return text.replace(".", ",");
}

export function ContoDelGiorno() {
  const [data, setData] = useState<DailyPnl | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lotSize, setLotSize] = useState("0.1");
  const [target, setTarget] = useState("400");
  const [maxLoss, setMaxLoss] = useState("150");
  const [rate, setRate] = useState("1.08");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/daily-pnl", { cache: "no-store" });
      if (!res.ok) throw new Error("fail");
      const json = (await res.json()) as DailyPnl;
      if (typeof json?.pnlEur !== "number") throw new Error("fail");
      setData(json);
      setError(false);
      setLotSize(String(json.lotSize));
      setTarget(String(json.target));
      setMaxLoss(String(json.maxLoss));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lot_size: Number(lotSize),
          daily_target_eur: Number(target),
          daily_max_loss_eur: Number(maxLoss),
          eurusd_rate: Number(rate),
        }),
      });
      if (!res.ok) throw new Error("fail");
      setOpen(false);
      await load();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const pnl = data?.pnlEur ?? 0;
  const tone =
    !data || pnl === 0
      ? "border-border bg-panel"
      : pnl > 0
        ? "border-[#3b82f6] bg-[#3b82f6]/15"
        : "border-[#ef4444] bg-[#ef4444]/15";

  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Oggi</span>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => {
              const next = !v;
              if (next) {
                void fetch("/api/settings", { cache: "no-store" })
                  .then((r) => r.json())
                  .then((s) => {
                    if (s?.lot_size != null) setLotSize(String(s.lot_size));
                    if (s?.daily_target_eur != null) setTarget(String(s.daily_target_eur));
                    if (s?.daily_max_loss_eur != null) setMaxLoss(String(s.daily_max_loss_eur));
                    if (s?.eurusd_rate != null) setRate(String(s.eurusd_rate));
                  })
                  .catch(() => undefined);
              }
              return next;
            });
          }}
          className="rounded p-1 text-muted hover:text-text"
          aria-label="Impostazioni conto del giorno"
        >
          <Settings size={14} />
        </button>
      </div>

      {loading && !data ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" />
          Calcolo…
        </div>
      ) : error && !data ? (
        <div className="mt-2 text-xs text-muted">Dati non disponibili</div>
      ) : data ? (
        <>
          <div className="mt-1 font-mono text-2xl font-semibold leading-tight text-text">
            {formatEur(data.pnlEur)}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {data.trades} trade · {data.wins} vinti · {data.losses} persi · lotti{" "}
            {formatLots(data.lotSize)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            Obiettivo {formatEur(data.target)} · Limite {formatEur(-Math.abs(data.maxLoss))}
          </div>
          {data.finished && (
            <div className="mt-2 rounded-md border border-gold/40 bg-gold/15 px-2 py-1 text-[11px] font-semibold text-gold">
              Per oggi abbiamo finito
            </div>
          )}
        </>
      ) : null}

      {open && (
        <form onSubmit={onSave} className="mt-3 space-y-2 border-t border-border pt-2">
          <label className="block text-[10px] uppercase tracking-wide text-muted">
            Lotti
            <input
              type="number"
              step="any"
              min="0"
              value={lotSize}
              onChange={(e) => setLotSize(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-panel2 px-2 py-1 font-mono text-xs text-text"
            />
          </label>
          <label className="block text-[10px] uppercase tracking-wide text-muted">
            Obiettivo €
            <input
              type="number"
              step="any"
              min="0"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-panel2 px-2 py-1 font-mono text-xs text-text"
            />
          </label>
          <label className="block text-[10px] uppercase tracking-wide text-muted">
            Perdita max €
            <input
              type="number"
              step="any"
              min="0"
              value={maxLoss}
              onChange={(e) => setMaxLoss(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-panel2 px-2 py-1 font-mono text-xs text-text"
            />
          </label>
          <label className="block text-[10px] uppercase tracking-wide text-muted">
            Cambio EURUSD
            <input
              type="number"
              step="any"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-panel2 px-2 py-1 font-mono text-xs text-text"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-md border border-border bg-panel2 px-2 py-1.5 text-xs font-semibold text-text disabled:opacity-60"
            >
              {saving ? "Salvo…" : "Salva"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted"
            >
              Annulla
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
