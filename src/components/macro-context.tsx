import { MarketQuote } from "@/lib/types";
import { DataStatusBadge } from "./data-status-badge";

function Row({ quote }: { quote: MarketQuote }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-xs font-medium text-text">{quote.symbol}</div>
        <div className="text-[10px] text-muted">{quote.label}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm text-text">{quote.price !== null ? quote.price.toFixed(2) : "—"}</div>
        <DataStatusBadge status={quote.status} label={quote.status === "disconnected" ? "N/D" : undefined} />
      </div>
    </div>
  );
}

export function MacroContext({ dxy, us10y }: { dxy: MarketQuote; us10y: MarketQuote }) {
  return (
    <div className="desk-card p-5">
      <span className="desk-kicker">Contesto macro</span>
      <div className="mt-2 divide-y divide-border">
        <Row quote={dxy} />
        <Row quote={us10y} />
      </div>
    </div>
  );
}
