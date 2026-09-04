"use client";

import { useState } from "react";

// La terna operativa e' M5 / M15 / M30: il grafico mostra gli stessi
// timeframe su cui l'agente rileva gli eventi.
const TIMEFRAMES = [
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
];

export function ChartPanel() {
  const [tf, setTf] = useState("5");

  const src = `https://s.tradingview.com/widgetembed/?frameElementId=tv-chart&symbol=OANDA%3AXAUUSD&interval=${tf}&hidesidetoolbar=1&hidetoptoolbar=0&symboledit=0&saveimage=0&toolbarbg=11151c&studies=%5B%5D&theme=dark&style=1&timezone=Etc%2FUTC`;

  return (
    <div className="desk-card overflow-hidden flex flex-col h-[560px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="desk-kicker">XAUUSD — Grafico live</span>
        <div className="desk-seg">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTf(t.value)}
              className={`desk-seg-btn ${tf === t.value ? "desk-seg-on" : "desk-seg-off"}`}
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
