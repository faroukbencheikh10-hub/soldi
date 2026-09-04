import { PerformanceStats } from "@/lib/types";
import { BarChart3 } from "lucide-react";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel2 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-mono text-lg text-text mt-1">{value}</div>
    </div>
  );
}

export function PerformanceStatsPanel({ stats }: { stats: PerformanceStats }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={15} className="text-gold" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Statistiche performance</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Segnali totali" value={String(stats.totalSignals)} />
        <StatCard label="Win rate" value={stats.winRate !== null ? `${stats.winRate}%` : "—"} />
        <StatCard label="R:R medio" value={stats.avgRR !== null ? stats.avgRR.toFixed(1) : "—"} />
        <StatCard label="Miglior condizione" value={stats.bestCondition ?? "—"} />
      </div>
      <p className="text-[10px] text-muted mt-3">
        Le statistiche si popolano automaticamente man mano che l&apos;agente accumula storico reale.
      </p>
    </div>
  );
}
