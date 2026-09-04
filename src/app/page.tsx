import { AppHeader } from "@/components/app-header";
import { ChartPanel } from "@/components/chart-panel";
import { SignalPanel } from "@/components/signal-panel";
import { GenerateSignalButton } from "@/components/generate-signal-button";
import { TestPushButton } from "@/components/test-push-button";
import { AiPauseToggle } from "@/components/ai-pause-toggle";
import { ChiamateToggle } from "@/components/chiamate-toggle";
import { SignalHistory } from "@/components/signal-history";
import { MacroContext } from "@/components/macro-context";
import { MarketHoursCompact } from "@/components/market-hours-compact";
import { ContextFeed } from "@/components/context-feed";
import { PerformanceStatsPanel } from "@/components/performance-stats";
import { TradeFolder } from "@/components/trade-folder";
import { SIGNAL_HISTORY as DEMO_HISTORY } from "@/lib/mock-data";
import { MarketQuote, TradeSignal, PerformanceStats } from "@/lib/types";
import {
  getLatestMarketSnapshot,
  getLatestContextSnapshot,
  getStats,
} from "@/lib/server/db";
import { getDashboardSignals } from "@/lib/server/latestTrade";
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
    resultR: row.result_r !== null && row.result_r !== undefined ? Number(row.result_r) : undefined,
    attivatoIl: row.attivato_il ?? null,
    isDemo: false,
  };
}

export default async function Home() {
  let marketSnapshot: any = null;
  let contextSnapshot: any = null;
  let statsRow: any = null;
  let dash: { latest: any; current: any; history: any[] } = { latest: null, current: null, history: [] };
  let dbError = false;

  try {
    [marketSnapshot, contextSnapshot, statsRow, dash] = await Promise.all([
      getLatestMarketSnapshot(),
      getLatestContextSnapshot(),
      getStats(),
      getDashboardSignals(),
    ]);
  } catch {
    dbError = true;
  }

  const hasLiveSignals = dash.current !== null || dash.latest !== null;
  const signalHistory: TradeSignal[] = hasLiveSignals ? dash.history.map(mapSignalRow) : DEMO_HISTORY;
  const currentSignal: TradeSignal | null = dash.current
    ? mapSignalRow(dash.current)
    : DEMO_HISTORY[0] ?? null;

  const SNAPSHOT_STALE_MINUTES = 20;
  const snapshotAgeMinutes = marketSnapshot?.created_at
    ? (Date.now() - new Date(marketSnapshot.created_at).getTime()) / 60000
    : null;
  const isStale = snapshotAgeMinutes !== null && snapshotAgeMinutes > SNAPSHOT_STALE_MINUTES;
  const xauusdQuotedAt = marketSnapshot?.raw?.xauusdQuotedAt ?? null;
  const xauusdAgeMinutes = xauusdQuotedAt ? (Date.now() - Number(xauusdQuotedAt)) / 60000 : null;

  const xauQuote: MarketQuote = {
    symbol: "XAUUSD",
    label: "Oro / USD",
    price: !isStale && marketSnapshot?.xauusd != null ? Number(marketSnapshot.xauusd) : null,
    changePercent: !isStale && marketSnapshot?.xauusd_change_pct != null ? Number(marketSnapshot.xauusd_change_pct) : null,
    status: dbError ? "error" : !isStale && marketSnapshot?.xauusd != null ? "live" : "disconnected",
    ageMinutes: xauusdAgeMinutes,
  };
  const dxyQuote: MarketQuote = {
    symbol: "DXY",
    label: "Indice dollaro",
    price: !isStale && marketSnapshot?.dxy != null ? Number(marketSnapshot.dxy) : null,
    changePercent: !isStale && marketSnapshot?.dxy_change_pct != null ? Number(marketSnapshot.dxy_change_pct) : null,
    status: dbError ? "error" : !isStale && marketSnapshot?.dxy != null ? "live" : "disconnected",
  };
  const us10yQuote: MarketQuote = {
    symbol: "US10Y",
    label: "US 10Y Yield",
    price: !isStale && marketSnapshot?.us10y != null ? Number(marketSnapshot.us10y) : null,
    changePercent: !isStale && marketSnapshot?.us10y_change_pct != null ? Number(marketSnapshot.us10y_change_pct) : null,
    status: dbError ? "error" : !isStale && marketSnapshot?.us10y != null ? "live" : "disconnected",
  };

  const marketCalendar = getMarketCalendarContext();
  const news = contextSnapshot?.news ?? [];
  const calendar = contextSnapshot?.calendar ?? [];
  const totalSignals = hasLiveSignals ? Number(statsRow?.total ?? 0) : signalHistory.length;
  const decided = Number(statsRow?.decided ?? 0);
  const wins = Number(statsRow?.wins ?? 0);
  const performanceStats: PerformanceStats = {
    totalSignals,
    winRate: hasLiveSignals && decided > 0 ? Math.round((wins / decided) * 100) : null,
    avgRR: hasLiveSignals && statsRow?.avg_rr ? Number(statsRow.avg_rr) : null,
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
            <TradeFolder trades={signalHistory} />
            <SignalHistory signals={signalHistory} />
          </div>
          <div className="space-y-5">
            <AiPauseToggle />
            <ChiamateToggle />
            <GenerateSignalButton label="Genera segnale ORB" />
            <TestPushButton variant="block" />
            <SignalPanel signal={currentSignal} />
            <MacroContext dxy={dxyQuote} us10y={us10yQuote} />
            <MarketHoursCompact mercati={marketCalendar} />
            <ContextFeed events={calendar} news={news} />
            <PerformanceStatsPanel stats={performanceStats} />
          </div>
        </div>
      </main>
    </>
  );
}
