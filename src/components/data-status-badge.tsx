import { ConnectionStatus } from "@/lib/types";
import { CircleDot, CircleOff, CircleAlert } from "lucide-react";

export function DataStatusBadge({ status, label }: { status: ConnectionStatus; label?: string }) {
  const config = {
    live: { icon: CircleDot, text: "Live", cls: "text-buy border-buy/30 bg-buy/10" },
    disconnected: { icon: CircleOff, text: "Dati non collegati", cls: "text-muted border-border bg-panel2" },
    error: { icon: CircleAlert, text: "Errore dati", cls: "text-sell border-sell/30 bg-sell/10" },
  }[status];

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.cls}`}>
      <Icon size={12} />
      {label ?? config.text}
    </span>
  );
}
