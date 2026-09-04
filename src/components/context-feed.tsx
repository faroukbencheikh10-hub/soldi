"use client";

import { useMemo, useState } from "react";
import { EconomicEvent, NewsItem } from "@/lib/types";
import { CalendarClock, Newspaper, Globe } from "lucide-react";
import { formatRecency } from "@/lib/formatTime";

type Tab = "globali" | "asia" | "calendar";

export function ContextFeed({ events, news }: { events: EconomicEvent[]; news: NewsItem[] }) {
  const [tab, setTab] = useState<Tab>("globali");

  const { globali, asia } = useMemo(() => {
    const asia = news.filter((n) => n.area === "asia");
    const globali = news.filter((n) => n.area !== "asia");
    return { globali, asia };
  }, [news]);

  const attive = tab === "asia" ? asia : globali;

  return (
    <div className="desk-card p-5">
      <div className="flex gap-1 rounded-lg bg-panel2 p-1 mb-4">
        <TabButton active={tab === "globali"} onClick={() => setTab("globali")}>
          <Newspaper size={13} /> Globali
          {globali.length > 0 && <Count n={globali.length} active={tab === "globali"} />}
        </TabButton>
        <TabButton active={tab === "asia"} onClick={() => setTab("asia")}>
          <Globe size={13} /> Asia
          {asia.length > 0 && <Count n={asia.length} active={tab === "asia"} />}
        </TabButton>
        <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")}>
          <CalendarClock size={13} /> Calendario
        </TabButton>
      </div>

      {tab === "calendar" ? (
        events.length === 0 ? (
          <EmptyState text="Il calendario economico di Finnhub richiede un piano superiore al gratuito (risposta 403 dall'API). Le news restano comunque coperte." />
        ) : (
          <ul className="space-y-2 overflow-auto max-h-[380px]">
            {events.map((e) => (
              <li key={e.id} className="text-xs border-b border-border/60 pb-2 last:border-0">
                <span className="font-mono text-muted">{e.time}</span> &mdash;{" "}
                <span className="text-text">{e.title}</span>
              </li>
            ))}
          </ul>
        )
      ) : attive.length === 0 ? (
        <EmptyState
          text={
            tab === "asia"
              ? "Nessuna notizia asiatica rilevante nelle ultime 24 ore."
              : "Nessuna notizia globale rilevante nelle ultime 24 ore."
          }
        />
      ) : (
        <ul className="space-y-2 overflow-auto max-h-[380px]">
          {attive.map((n) => (
            <li key={n.id} className="text-xs border-b border-border/60 pb-2 last:border-0">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-muted">{n.source}</span>
                <span className="font-mono text-[10px] text-muted whitespace-nowrap">
                  {formatRecency(n.time)}
                </span>
              </div>
              <span className="text-text">{n.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
        active ? "bg-gold text-black" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 text-[10px] font-mono ${
        active ? "bg-black/20 text-black" : "bg-border text-muted"
      }`}
    >
      {n}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-panel2 py-6 px-3 text-center">
      <p className="text-xs text-muted">{text}</p>
    </div>
  );
}
