// Eccezione Asia.
//
// NON cambia strategia ne' notifiche: decide SOLO se in questo ciclo cron e'
// permesso chiamare l'AI (OpenAI). Fuori dalla sessione Asia il comportamento
// resta quello di sempre (AI chiamata a ogni ciclo). Dentro la sessione Asia,
// l'AI viene chiamata solo se c'e' un evento di calendario ad alto impatto
// vicino, oppure una breaking news rilevante per XAUUSD appena uscita.
//
// La sessione Asia e' gia' calcolata da computeSessionInfo() in marketData.ts
// (marketSnapshot.session.sessione === "asia") -- qui la riusiamo, non la
// ricalcoliamo.

import type { EconomicEvent } from "@/lib/server/calendar";
import type { NewsItem } from "@/lib/server/news";
import type { StructureResult } from "@/lib/server/ictStructure";
import type { RejectionSignal } from "@/lib/server/rejection";

const NEWS_EVENT_WINDOW_MINUTES = 30;

const BREAKING_NEWS_MAX_AGE_MINUTES = 15;

export interface AiGateResult {
  allowed: boolean;
  reason: string;
}

function hasHighImpactEventNearby(now: Date, calendar: EconomicEvent[]): EconomicEvent | null {
  const windowMs = NEWS_EVENT_WINDOW_MINUTES * 60 * 1000;
  return (
    calendar.find((e) => {
      if (e.impact !== "high") return false;
      const eventTime = new Date(e.time).getTime();
      if (!Number.isFinite(eventTime)) return false;
      return Math.abs(eventTime - now.getTime()) <= windowMs;
    }) ?? null
  );
}

function hasBreakingNews(now: Date, news: NewsItem[]): NewsItem | null {
  const maxAgeMs = BREAKING_NEWS_MAX_AGE_MINUTES * 60 * 1000;
  return (
    news.find((n) => {
      if (!n.time) return false;
      const publishedAt = new Date(n.time).getTime();
      if (!Number.isFinite(publishedAt)) return false;
      const ageMs = now.getTime() - publishedAt;
      return ageMs >= 0 && ageMs <= maxAgeMs;
    }) ?? null
  );
}

export function shouldCallAI(
  isAsiaSession: boolean,
  calendar: EconomicEvent[],
  news: NewsItem[],
  now: Date = new Date()
): AiGateResult {
  void isAsiaSession;
  void calendar;
  void news;
  void now;
  return { allowed: true, reason: "Eccezione Asia disattivata - AI chiamata sempre, 24 ore su 24" };
}

const DISPLACEMENT_MIN_ATR = 1;

export interface TechnicalSetupInput {
  ictStrutturaM15: StructureResult;
  ictStrutturaM5: StructureResult;
  rigetto5m: RejectionSignal;
  rigetto15m: RejectionSignal;
  rigetto30m: RejectionSignal;
  liquidita24h: { massimo: number; minimo: number } | null;
  rangeAccumulo?: { attivo: boolean; motivo: string } | null;
  ictOrderBlocksH4?: { top: number; bottom: number }[];
  ictFvgH4?: { top: number; bottom: number }[];
  ictOrderBlocksH1?: { top: number; bottom: number }[];
  ictFvgH1?: { top: number; bottom: number }[];
  ictOrderBlocksM15?: { top: number; bottom: number }[];
  ictFvgM15?: { top: number; bottom: number }[];
}

export interface TechnicalSetupResult {
  allowed: boolean;
  count: number;
  segnali: string[];
  reason: string;
}

function isDisplacement(rigetto: RejectionSignal): boolean {
  if (!rigetto?.rilevato) return false;
  const ampiezza = rigetto.ampiezzaImpulsoInAtr;
  return typeof ampiezza === "number" && Number.isFinite(ampiezza) && ampiezza >= DISPLACEMENT_MIN_ATR;
}

export interface EventoAttivoSintesi {
  tipo: string;
  timeframe: string;
  direzione: string;
  livello: number;
}

export function hasTechnicalSetup(
  snapshot: TechnicalSetupInput,
  prezzo: number,
  sogliaSegnali: number,
  eventiAttivi: EventoAttivoSintesi[] = []
): TechnicalSetupResult {
  const segnali: string[] = [];

  for (const e of eventiAttivi) {
    segnali.push(`${e.tipo.toUpperCase()} ${e.timeframe} ${e.direzione} a ${Number(e.livello).toFixed(2)} (ancora attivo)`);
  }

  const eventoM15 = snapshot.ictStrutturaM15?.evento ?? null;
  if (eventoM15) {
    segnali.push(`${eventoM15} su M15 (${snapshot.ictStrutturaM15.direzioneEvento ?? "direzione n/d"})`);
  }

  const eventoM5 = snapshot.ictStrutturaM5?.evento ?? null;
  if (eventoM5) {
    segnali.push(`${eventoM5} su M5 (${snapshot.ictStrutturaM5.direzioneEvento ?? "direzione n/d"})`);
  }

  if (isDisplacement(snapshot.rigetto5m)) {
    segnali.push(`displacement 5m (impulso ${snapshot.rigetto5m.ampiezzaImpulsoInAtr?.toFixed(2)} ATR)`);
  }

  if (isDisplacement(snapshot.rigetto15m)) {
    segnali.push(`displacement 15m (impulso ${snapshot.rigetto15m.ampiezzaImpulsoInAtr?.toFixed(2)} ATR)`);
  }

  const liq = snapshot.liquidita24h;
  if (liq && Number.isFinite(prezzo)) {
    if (prezzo >= liq.massimo) {
      segnali.push(`rottura del massimo 24h (${liq.massimo})`);
    } else if (prezzo <= liq.minimo) {
      segnali.push(`rottura del minimo 24h (${liq.minimo})`);
    }
  }

  const count = segnali.length;

  // H4 non entra in questo veto: e' solo contesto per l'AI.
  const zone = [
    ...(snapshot.ictOrderBlocksH1 ?? []),
    ...(snapshot.ictFvgH1 ?? []),
    ...(snapshot.ictOrderBlocksM15 ?? []),
    ...(snapshot.ictFvgM15 ?? []),
  ];
  const dentroUnaZona = zone.some((z) => {
    const top = Number(z?.top);
    const bottom = Number(z?.bottom);
    return Number.isFinite(top) && Number.isFinite(bottom) && prezzo >= bottom && prezzo <= top;
  });

  if (zone.length > 0 && !dentroUnaZona) {
    return {
      allowed: false,
      count,
      segnali,
      reason: `Prezzo ${prezzo.toFixed(2)} fuori da tutte le ${zone.length} zone H1/M15: AI non chiamata.`,
    };
  }

  if (snapshot.rangeAccumulo?.attivo) {
    return {
      allowed: false,
      count,
      segnali,
      reason: `Trade evitato: ${snapshot.rangeAccumulo.motivo}. Setup tecnico rilevato: ${count}/${sogliaSegnali}. AI non chiamata.`,
    };
  }

  const allowed = count >= sogliaSegnali;

  const reason = allowed
    ? `Filtro tecnico superato (${count}/${sogliaSegnali}): ${segnali.join("; ")}`
    : count === 0
      ? `Nessun setup tecnico rilevato (servono ${sogliaSegnali} segnali): nessun BOS/CHoCH, nessun displacement, nessuna rottura di liquidita' 24h. AI non chiamata per non sprecare credito.`
      : `Setup tecnico insufficiente (${count}/${sogliaSegnali}): ${segnali.join("; ")}. AI non chiamata per non sprecare credito.`;

  return { allowed, count, segnali, reason };
}
