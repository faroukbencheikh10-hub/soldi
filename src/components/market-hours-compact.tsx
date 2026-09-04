import type { MarketCalendarContext, MarketCalendarStatus } from "@/lib/server/marketCalendar";

// Box "Mercati": una riga per mercato, stato OPEN/CLOSED in questo momento.
//
// Nessun countdown, nessun timer, nessuna chiamata: lo stato arriva gia'
// calcolato dal server (page.tsx). L'eventuale festivita' precedente non viene
// mostrata: serve solo all'AI.

const ORDINE: Array<keyof MarketCalendarContext> = ["london", "new_york", "tokyo", "comex_gold"];

function Riga({ m }: { m: MarketCalendarStatus }) {
  const aperto = m.today.status === "open";

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="truncate text-xs font-medium text-text">
        {m.icon} {m.name}
      </span>

      <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
        {m.today.holidayName ? (
          <span className="max-w-[140px] truncate text-[10px] text-gold">{m.today.holidayName}</span>
        ) : null}
        <span className={aperto ? "text-buy" : "text-sell"}>
          {aperto ? "🟢 Aperto" : "🔴 Chiuso"}
        </span>
      </span>
    </div>
  );
}

export function MarketHoursCompact({ mercati }: { mercati: MarketCalendarContext }) {
  return (
    <div className="desk-card p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Mercati</span>
      <div className="mt-1 divide-y divide-border">
        {ORDINE.map((id) => (
          <Riga key={id} m={mercati[id]} />
        ))}
      </div>
    </div>
  );
}
