"use client";

import { useState } from "react";

const TIMEFRAMES = [
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
];

export function ChartPanel() {
  const [tf, setTf] = useState("5");

  const src = `https://s.tradingview.com/widgetembed/?frameElementId=tv-chart&symbol=OANDA%3AXAUUSD&interval=${tf}&hidesidetoolbar=1&hidetoptoolbar=0&symboledit=0&saveimage=0&toolbarbg=11151c&studies=%5B%5D&theme=dark&style=1&timezone=Etc%2FUTC`;

  return (
    <div className="rounded-xl border border-border bg-panel overflow-hidden flex flex-col h-[520px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">XAUUSD — Grafico live</span>
        <div className="flex gap-1 rounded-lg bg-panel2 p-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTf(t.value)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                tf === t.value ? "bg-gold text-black" : "text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <iframe key={tf} src={src} className="h-full w-full border-0" title="Grafico XAUUSD" />
      </div>
    </div>
  );
}
