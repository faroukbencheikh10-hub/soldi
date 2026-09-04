import { Gem } from "lucide-react";
import { MarketQuote } from "@/lib/types";
import { PriceTicker } from "./price-ticker";
import { NotificationBell } from "./notification-bell";

export function AppHeader({ quote }: { quote: MarketQuote }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-base/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-goldSoft text-black">
            <Gem size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-text leading-none">Soldi ORB</div>
            <div className="text-[11px] text-muted leading-none mt-0.5">XAUUSD · Session ORB · fade Asia · break Londra/NY</div>
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
