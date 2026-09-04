import { Gem } from "lucide-react";
import { MarketQuote } from "@/lib/types";
import { PriceTicker } from "./price-ticker";
import { NotificationBell } from "./notification-bell";

export function AppHeader({ quote }: { quote: MarketQuote }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#07090d]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-goldSoft text-black shadow-[0_0_20px_rgba(212,175,90,0.25)]">
            <Gem size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-text leading-none">Investment Pal</div>
            <div className="text-[11px] text-muted leading-none mt-0.5">Analisi XAUUSD &amp; Segnali</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <PriceTicker quote={quote} />
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
