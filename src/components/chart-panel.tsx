"use client";

import { useMemo, useState } from "react";

const TIMEFRAMES = [
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
] as const;

export function ChartPanel() {
  const [tf, setTf] = useState("5");

  const src = useMemo(() => {
    const config = {
      autosize: true,
      symbol: "OANDA:XAUUSD",
      interval: tf,
      timezone: "Etc/UTC",
      theme: "light",
      style: "1",
      locale: "it",
      backgroundColor: "#ffffff",
      gridColor: "#eef0f4",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    };
    return `https://www.tradingview.com/embed-widget/advanced-chart/?locale=it#${encodeURIComponent(JSON.stringify(config))}`;
  }, [tf]);

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-white">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">XAUUSD — Grafico live</span>
        <div className="flex gap-1 rounded-lg bg-panel2 p-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTf(t.value)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium ${
                tf === t.value ? "bg-gold text-white" : "text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative w-full bg-white" style={{ height: 520 }}>
        <iframe
          key={`light-${tf}`}
          src={src}
          title={`Grafico XAUUSD ${tf}m`}
          className="absolute inset-0 h-full w-full border-0 bg-white"
          referrerPolicy="no-referrer-when-downgrade"
          allow="fullscreen; clipboard-write"
        />
      </div>
    </div>
  );
}
