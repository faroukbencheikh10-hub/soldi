import { AppHeader } from "@/components/app-header";
import { ChartPanel } from "@/components/chart-panel";
import { SignalPanel } from "@/components/signal-panel";
import { GenerateSignalButton } from "@/components/generate-signal-button";
import { AiPauseToggle } from "@/components/ai-pause-toggle";
import { StrategiaToggle } from "@/components/strategia-toggle";
import { SignalHistory } from "@/components/signal-history";
import { MacroContext } from "@/components/macro-context";
import { MarketHoursCompact } from "@/components/market-hours-compact";
import { ContextFeed } from "@/components/context-feed";
import { PerformanceStatsPanel } from "@/components/performance-stats";
import { SIGNAL_HISTORY as DEMO_HISTORY } from "@/lib/mock-data";
import { MarketQuote, TradeSignal, PerformanceStats } from "@/lib/types";
import {
  getLatestMarketSnapshot,
  getLatestContextSnapshot,
  getSignalHistory,
  getStats,
  getLatestSignal,
} from "@/lib/server/db";
import { SignalWatcher } from "@/components/signal-watcher";
import { getMarketCalendarContext } from "@/lib/server/marketCalendar";

export const dynamic = "force-dynamic";

function mapSignalRow(row: any): TradeSignal {
  return {
    id: row.id,
    createdAt: row.created_at,
    direction: row.direction,
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    tp1: Number(row.tp1),
    tp2: Number(row.tp2),
    riskReward: Number(row.risk_reward),
    confidence: Number(row.confidence),
    reasoning: row.reasoning,
    outcome: row.outcome ?? undefined,
    resultR: row.result_r !== null ? Number(row.result_r) : undefined,
    isDemo: false,
  };
}

export default async function Home() {
  let marketSnapshot: any = null;
  let contextSnapshot: any = null;
  let historyRows: any[] = [];
  let statsRow: any = null;
  let latestSignalRow: any = null;
  let dbError = false;

  try {
    [
      marketSnapshot,
      contextSnapshot,
      historyRows,
      statsRow,
      latestSignalRow,
    ] = await Promise.all([
      getLatestMarketSnapshot(),
      getLatestContextSnapshot(),
      getSignalHistory(20),
      getStats(),
      getLatestSignal(),
    ]);
  } catch {
    dbError = true;
  }

  const hasLiveSignals = latestSignalRow !== null;
  const signalHistory: TradeSignal[] = hasLiveSignals ? historyRows.map(mapSignalRow) : DEMO_HISTORY;
  const currentSignal: TradeSignal | null = hasLiveSignals
    ? mapSignalRow(latestSignalRow)
    : DEMO_HISTORY[0] ?? null;

  const SNAPSHOT_STALE_MINUTES = 20;
  const snapshotAgeMinutes = marketSnapshot?.created_at
    ? (Date.now() - new Date(marketSnapshot.created_at).getTime()) / 60000
    : null;
  const isStale = snapshotAgeMinutes !== null && snapshotAgeMinutes > SNAPSHOT_STALE_MINUTES;

  const xauusdQuotedAt = marketSnapshot?.raw?.xauusdQuotedAt ?? null;
  const xauusdAgeMinutes = xauusdQuotedAt
    ? (Date.now() - Number(xauusdQuotedAt)) / 60000
    : null;

  const xauQuote: MarketQuote = {
    symbol: "XAUUSD",
    label: "Oro / USD",
    price: !isStale && marketSnapshot?.xauusd !== null && marketSnapshot?.xauusd !== undefined ? Number(marketSnapshot.xauusd) : null,
    changePercent: !isStale && marketSnapshot?.xauusd_change_pct !== null && marketSnapshot?.xauusd_change_pct !== undefined ? Number(marketSnapshot.xauusd_change_pct) : null,
    status: dbError ? "error" : !isStale && marketSnapshot?.xauusd !== null && marketSnapshot?.xauusd !== undefined ? "live" : "disconnected",
    ageMinutes: xauusdAgeMinutes,
  };
  const dxyQuote: MarketQuote = {
    symbol: "DXY",
    label: "Indice dollaro",
    price: !isStale && marketSnapshot?.dxy !== null && marketSnapshot?.dxy !== undefined ? Number(marketSnapshot.dxy) : null,
    changePercent: !isStale && marketSnapshot?.dxy_change_pct !== null && marketSnapshot?.dxy_change_pct !== undefined ? Number(marketSnapshot.dxy_change_pct) : null,
    status: dbError ? "error" : !isStale && marketSnapshot?.dxy !== null && marketSnapshot?.dxy !== undefined ? "live" : "disconnected",
  };
  const us10yQuote: MarketQuote = {
    symbol: "US10Y",
    label: "US 10Y Yield",
    price: !isStale && marketSnapshot?.us10y !== null && marketSnapshot?.us10y !== undefined ? Number(marketSnapshot.us10y) : null,
    changePercent: !isStale && marketSnapshot?.us10y_change_pct !== null && marketSnapshot?.us10y_change_pct !== undefined ? Number(marketSnapshot.us10y_change_pct) : null,
    status: dbError ? "error" : !isStale && marketSnapshot?.us10y !== null && marketSnapshot?.us10y !== undefined ? "live" : "disconnected",
  };

  // Stato dei mercati calcolato server-side, come tutto il resto della pagina.
  const marketCalendar = getMarketCalendarContext();

  const news = contextSnapshot?.news ?? [];
  const calendar = contextSnapshot?.calendar ?? [];

  const totalSignals = hasLiveSignals ? Number(statsRow?.total ?? 0) : signalHistory.length;
  const decided = Number(statsRow?.decided ?? 0);
  const wins = Number(statsRow?.wins ?? 0);
  const winRate = hasLiveSignals && decided > 0 ? Math.round((wins / decided) * 100) : null;
  const avgRR = hasLiveSignals && statsRow?.avg_rr ? Number(statsRow.avg_rr) : null;

  const performanceStats: PerformanceStats = {
    totalSignals,
    winRate,
    avgRR,
    bestCondition: null,
  };

  return (
    <>
      <SignalWatcher />
      <AppHeader quote={xauQuote} />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px] items-start">
          <div className="space-y-5">
            <ChartPanel />
            <SignalHistory signals={signalHistory} />
          </div>

          <div className="space-y-5">
            <StrategiaToggle />
            <AiPauseToggle />
            <GenerateSignalButton />
            <SignalPanel signal={currentSignal} />
            <MacroContext dxy={dxyQuote} us10y={us10yQuote} />
            <MarketHoursCompact mercati={marketCalendar} />
            <ContextFeed events={calendar} news={news} />
            <PerformanceStatsPanel stats={performanceStats} />
          </div>
        </div>

        {/* Canale "trade veloce" (5m): sezione rimossa dalla dashboard su
            richiesta -- non serve per ora. Backend/dati invariati (tabella
            signals_5m, route /api/generate-5m, cron gia' disattivato in
            /api/cron/analyze-5m), cosi' e' facile da riattivare in futuro
            senza perdere storico. */}

      </main>
    </>
  );
}
