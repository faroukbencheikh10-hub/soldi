"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

type Zona = { da: number | null; a: number | null };
type Evento = { data: string; oraUtc: string; nome: string; impatto: string };
type Finestra = { daIso: string; aIso: string; nome: string };

type Mappa = {
  id?: string;
  direzione?: string;
  forza?: string;
  motivo?: string;
  zonaBuy?: Zona;
  zonaSell?: Zona;
  invalidazione?: number | null;
  eventiChiave?: Evento[];
  orariDaEvitare?: Finestra[];
  rigenerata?: boolean;
  created_at?: string;
};

type Trade = {
  id: string;
  direzione: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number | null;
  confidence: number | null;
  spiegazione: string | null;
  aperto_il: string;
  chiuso_il: string | null;
  esito: string | null;
  r_finale: number | null;
  pnl_usd: number | null;
  mfe_usd: number | null;
  mae_usd: number | null;
  giorni_in_trade: number | null;
  giorno_ingresso: string | null;
  eseguito_live: boolean;
  note_live: string | null;
  week_start: string;
};

type State = {
  week_start: string;
  mappa: Mappa | null;
  trade: Trade | null;
  snapshot: { ts: string; price: number; pnl_r: number | null; pnl_usd: number | null } | null;
  floating: { pnlR: number | null; pnlUsd: number } | null;
  last_no_trade: { ts: string; motivo: string } | null;
  conto: {
    settimana: { usd: number; r: number };
    totale: { usd: number; r: number };
    wins: number;
    losses: number;
    parziali: number;
    settimane_con_trade: number;
    settimane_senza_trade: number;
  };
};

type HistoryPayload = {
  results: Array<{
    week_start: string;
    direzione_prevista: string | null;
    chiusura_weekly_reale: number | null;
    direzione_reale: string | null;
    mappa_corretta: boolean | null;
    zona_buy_toccata: boolean | null;
    zona_sell_toccata: boolean | null;
    trade_id: string | null;
    evento_dominante: string | null;
  }>;
  trades: Trade[];
  maps: Array<{ week_start: string; mappa: Mappa; rigenerata: boolean }>;
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(Number(n))) return "N/D";
  return Number(n).toFixed(d);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "N/D";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} $`;
}

function pnlClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "text-muted";
  return Number(n) >= 0 ? "text-sky-400" : "text-sell";
}

function DirBadge({ dir }: { dir: string }) {
  const d = dir.toUpperCase();
  if (d === "BUY") {
    return (
      <span className="inline-flex rounded-lg bg-buy/15 px-2.5 py-1 text-xs font-semibold text-buy">BUY</span>
    );
  }
  if (d === "SELL") {
    return (
      <span className="inline-flex rounded-lg bg-sell/15 px-2.5 py-1 text-xs font-semibold text-sell">SELL</span>
    );
  }
  return (
    <span className="inline-flex rounded-lg bg-panel2 px-2.5 py-1 text-xs font-semibold text-muted">
      {d || "NEUTRALE"}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-text">{value}</div>
    </div>
  );
}

function zonaTxt(z?: Zona | null): string {
  if (!z || z.da == null || z.a == null) return "N/D";
  return `${fmt(z.da)} – ${fmt(z.a)}`;
}

function siNo(v: boolean | null | undefined): string {
  if (v === true) return "sì";
  if (v === false) return "no";
  return "N/D";
}

export function TradeSettimana() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sRes, hRes] = await Promise.all([
        fetch("/api/settimana/state", { cache: "no-store" }),
        fetch("/api/settimana/history", { cache: "no-store" }),
      ]);
      if (!sRes.ok) throw new Error("state");
      const s = (await sRes.json()) as State;
      setState(s);
      setLive(Boolean(s.trade?.eseguito_live));
      setNote(s.trade?.note_live ?? "");
      if (hRes.ok) setHistory((await hRes.json()) as HistoryPayload);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const rows = useMemo(() => {
    if (!history) return [];
    const tradeByWeek = new Map<string, Trade>();
    for (const t of history.trades ?? []) {
      if (!tradeByWeek.has(t.week_start)) tradeByWeek.set(t.week_start, t);
    }
    const weeks = new Set<string>();
    for (const r of history.results ?? []) weeks.add(r.week_start);
    for (const t of history.trades ?? []) weeks.add(t.week_start);
    for (const m of history.maps ?? []) weeks.add(m.week_start);
    return [...weeks]
      .sort((a, b) => b.localeCompare(a))
      .map((week) => {
        const res = history.results.find((r) => r.week_start === week);
        const trade = tradeByWeek.get(week);
        return { week, res, trade };
      });
  }, [history]);

  async function onLive(e: FormEvent) {
    e.preventDefault();
    if (!state?.trade || busy) return;
    setBusy(true);
    try {
      await fetch("/api/settimana/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.trade.id,
          eseguito_live: live,
          note_live: note,
        }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    if (!state?.trade || state.trade.esito !== "OPEN" || busy) return;
    const motivo = window.prompt("Motivo chiusura manuale?");
    if (motivo == null) return;
    if (!window.confirm("Chiudere il trade della settimana?")) return;
    setBusy(true);
    try {
      await fetch("/api/settimana/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: state.trade.id, motivo }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const mappa = state?.mappa ?? null;
  const trade = state?.trade ?? null;
  const open = trade?.esito === "OPEN";
  const pnlR = open ? state?.floating?.pnlR ?? state?.snapshot?.pnl_r ?? null : trade?.r_finale ?? null;
  const pnlUsd = open ? state?.floating?.pnlUsd ?? state?.snapshot?.pnl_usd ?? null : trade?.pnl_usd ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Mappa della settimana</span>
          {mappa?.rigenerata && (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-gold">
              rigenerata
            </span>
          )}
        </div>
        {loading && !state && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" /> Carico…
          </div>
        )}
        {error && !state ? (
          <p className="text-xs text-muted">Dati settimana non disponibili</p>
        ) : !mappa ? (
          <div className="rounded-lg border border-dashed border-border bg-panel2 px-3 py-6 text-center">
            <p className="text-xs text-muted">Mappa non ancora generata</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <DirBadge dir={mappa.direzione ?? "NEUTRALE"} />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-muted">Forza</div>
                <div className="text-sm text-text">{mappa.forza ?? "N/D"}</div>
              </div>
            </div>
            <p className="mb-3 whitespace-pre-line text-xs leading-relaxed text-text">{mappa.motivo || "N/D"}</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Metric label="Zona BUY" value={zonaTxt(mappa.zonaBuy)} />
              <Metric label="Zona SELL" value={zonaTxt(mappa.zonaSell)} />
              <Metric label="Invalidazione" value={fmt(mappa.invalidazione ?? null)} />
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted">Eventi chiave</div>
            {(mappa.eventiChiave ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-muted">N/D</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {mappa.eventiChiave!.map((e, i) => (
                  <li key={`${e.nome}-${i}`} className="text-xs text-text">
                    <span className="font-mono text-muted">
                      {e.data} {e.oraUtc} UTC
                    </span>{" "}
                    {e.nome} <span className="text-gold">{e.impatto}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-[10px] uppercase tracking-wide text-muted">Orari da evitare</div>
            {(mappa.orariDaEvitare ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-muted">N/D</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {mappa.orariDaEvitare!.map((f, i) => (
                  <li key={`${f.nome}-${i}`} className="font-mono text-[11px] text-muted">
                    {f.daIso.slice(11, 16)}–{f.aIso.slice(11, 16)} UTC · {f.nome}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-panel p-5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Trade della settimana</span>
        {!trade ? (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-panel2 px-3 py-6 text-center">
            <p className="text-sm text-text">Nessun trade questa settimana</p>
            {state?.last_no_trade && <p className="mt-1 text-xs text-muted">{state.last_no_trade.motivo}</p>}
          </div>
        ) : (
          <>
            <div className="mt-3 mb-3 flex items-center justify-between">
              <DirBadge dir={trade.direzione} />
              <span className="text-[11px] uppercase tracking-wide text-muted">{trade.esito ?? "N/D"}</span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Entry" value={fmt(trade.entry)} />
              <Metric label="SL" value={fmt(trade.sl)} />
              <Metric label="R:R" value={fmt(trade.rr, 1)} />
              <Metric label="TP1" value={fmt(trade.tp1)} />
              <Metric label="TP2" value={fmt(trade.tp2)} />
              <Metric label="Conf." value={trade.confidence != null ? `${fmt(trade.confidence, 0)}` : "N/D"} />
              <Metric label="Ingresso" value={trade.giorno_ingresso ?? "N/D"} />
              <Metric label="Giorni" value={trade.giorni_in_trade != null ? String(trade.giorni_in_trade) : open ? "…" : "N/D"} />
              <Metric label="MFE / MAE" value={`${fmtUsd(trade.mfe_usd)} / ${fmtUsd(trade.mae_usd)}`} />
            </div>
            <div className="mb-3 rounded-lg border border-border bg-panel2 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted">{open ? "P&L aperto" : "P&L finale"}</div>
              <div className={`font-mono text-lg font-semibold ${pnlClass(pnlUsd)}`}>
                {fmtUsd(pnlUsd)} · {fmt(pnlR, 2)} R
              </div>
              {trade.chiuso_il && <div className="mt-0.5 font-mono text-[10px] text-muted">{trade.chiuso_il}</div>}
            </div>
            {trade.spiegazione && <p className="mb-3 text-xs leading-relaxed text-text">{trade.spiegazione}</p>}
            <form onSubmit={onLive} className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-xs text-text">
                <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-gold" />
                Aperto in live
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Nota live (informativa)"
                className="w-full rounded-md border border-border bg-panel2 px-2 py-1.5 text-xs text-text"
              />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className="rounded-md bg-panel2 px-3 py-1.5 text-xs font-medium text-text hover:text-gold">
                  Salva nota
                </button>
                {open && (
                  <button type="button" onClick={() => void onClose()} disabled={busy} className="rounded-md border border-sell/40 px-3 py-1.5 text-xs font-medium text-sell">
                    Chiudi a mano
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-panel p-5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Conto settimana</span>
        <div className={`mt-1 font-mono text-2xl font-semibold ${pnlClass(state?.conto.settimana.usd)}`}>
          {fmtUsd(state?.conto.settimana.usd)} · {fmt(state?.conto.settimana.r, 2)} R
        </div>
        <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Conto totale</div>
        <div className={`mt-1 font-mono text-xl font-semibold ${pnlClass(state?.conto.totale.usd)}`}>
          {fmtUsd(state?.conto.totale.usd)} · {fmt(state?.conto.totale.r, 2)} R
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {state?.conto.wins ?? 0} vinti · {state?.conto.losses ?? 0} persi · {state?.conto.parziali ?? 0} parziali
        </p>
        <p className="text-[11px] text-muted">
          {state?.conto.settimane_con_trade ?? 0} settimane con trade · {state?.conto.settimane_senza_trade ?? 0} senza
        </p>
      </div>

      <div className="rounded-xl border border-border bg-panel p-5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Storico settimane</span>
        <div className="-mx-1 mt-3 overflow-x-auto">
          <table className="min-w-[640px] w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-2 font-medium">Settimana</th>
                <th className="py-1.5 pr-2 font-medium">Previsto</th>
                <th className="py-1.5 pr-2 font-medium">Weekly</th>
                <th className="py-1.5 pr-2 font-medium">Mappa ok</th>
                <th className="py-1.5 pr-2 font-medium">Zone</th>
                <th className="py-1.5 pr-2 font-medium">Esito</th>
                <th className="py-1.5 pr-2 font-medium">R</th>
                <th className="py-1.5 pr-2 font-medium">MFE/MAE</th>
                <th className="py-1.5 pr-2 font-medium">Ing.</th>
                <th className="py-1.5 font-medium">Live</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-muted">
                    Nessuna settimana registrata
                  </td>
                </tr>
              ) : (
                rows.map(({ week, res, trade: t }) => (
                  <tr key={week} className="border-b border-border/60">
                    <td className="py-1.5 pr-2 font-mono text-muted">{week}</td>
                    <td className="py-1.5 pr-2">{res?.direzione_prevista ?? t?.direzione ?? "N/D"}</td>
                    <td className="py-1.5 pr-2 font-mono">{fmt(res?.chiusura_weekly_reale ?? null)}</td>
                    <td className="py-1.5 pr-2">{siNo(res?.mappa_corretta)}</td>
                    <td className="py-1.5 pr-2">
                      B {siNo(res?.zona_buy_toccata)} / S {siNo(res?.zona_sell_toccata)}
                    </td>
                    <td className="py-1.5 pr-2">{t?.esito ?? "—"}</td>
                    <td className={`py-1.5 pr-2 font-mono ${pnlClass(t?.r_finale)}`}>{fmt(t?.r_finale, 2)}</td>
                    <td className="py-1.5 pr-2 font-mono">
                      {fmtUsd(t?.mfe_usd)}/{fmtUsd(t?.mae_usd)}
                    </td>
                    <td className="py-1.5 pr-2">{t?.giorno_ingresso ?? "N/D"}</td>
                    <td className="py-1.5">{t ? (t.eseguito_live ? "sì" : "no") : "N/D"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
