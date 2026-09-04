import { Gem } from "lucide-react";
import { MarketQuote } from "@/lib/types";
import { PriceTicker } from "./price-ticker";
import { NotificationBell } from "./notification-bell";
import { TestPushButton } from "./test-push-button";

export function AppHeader({ quote }: { quote: MarketQuote }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-goldSoft text-black">
            <Gem size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text leading-none">Soldi ORB</div>
            <div className="text-[11px] text-muted leading-none mt-0.5 truncate">XAUUSD · ORB M5 · 24/5</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <PriceTicker quote={quote} />
          <TestPushButton variant="header" />
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
