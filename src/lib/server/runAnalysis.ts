import {
  ensureSchema,
  insertSignal,
  insertMarketSnapshot,
  insertContextSnapshot,
  getLatestSignal,
  getSegnaleAttivo,
  getSegnaliInAttesa,
  attivaSegnale,
  scadeSegnaleInAttesa,
  closeSignal,
  insertSignal5m,
  getLatestSignal5m,
  closeSignal5m,
  isAiPaused,
  getSetting,
  setSetting,
  inserisciEventiSetup,
  inserisciContesto,
  getUltimoContesto,
  getEventiSetupAttivi,
  chiudiEventoSetup,
  salvaCandeleMemoria,
  pulisciCandeleMemoria,
} from "@/lib/server/db";
import { getMarketSnapshot, getCurrentPrice, isMarketOpen, type MarketSnapshot } from "@/lib/server/marketData";
import { metaApiFetchTimeSeries } from "@/lib/server/metaApiData";
import { getRelevantNews } from "@/lib/server/news";
import { getEconomicCalendar } from "@/lib/server/calendar";
import { generateSignal, generateSignal5m, generaScenarioNotizia } from "@/lib/server/agent";
import { validateSignal } from "@/lib/server/validateSignal";
import { valutaSetupIctOriginale } from "@/lib/server/valutaIct";
