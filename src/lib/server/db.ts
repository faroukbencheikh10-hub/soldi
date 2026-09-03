import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non impostata");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export async function ensureSchema() {
  const client = getPool();
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      direction TEXT NOT NULL CHECK (direction IN ('BUY','SELL','NO_TRADE')),
      entry NUMERIC NOT NULL,
      stop_loss NUMERIC NOT NULL,
      tp1 NUMERIC NOT NULL,
      tp2 NUMERIC NOT NULL,
      risk_reward NUMERIC NOT NULL,
      confidence NUMERIC NOT NULL,
      reasoning TEXT NOT NULL,
      market_snapshot JSONB,
      outcome TEXT CHECK (outcome IN ('WIN','LOSS','OPEN','BREAKEVEN')),
      result_r NUMERIC,
      closed_at TIMESTAMPTZ,
      is_demo BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at DESC);

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      xauusd NUMERIC,
      xauusd_change_pct NUMERIC,
      dxy NUMERIC,
      dxy_change_pct NUMERIC,
      us10y NUMERIC,
      us10y_change_pct NUMERIC,
      raw JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_market_snapshots_created_at ON market_snapshots (created_at DESC);

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      news JSONB,
      calendar JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_context_snapshots_created_at ON context_snapshots (created_at DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      endpoint TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals_5m (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      direction TEXT NOT NULL CHECK (direction IN ('BUY','SELL','NO_TRADE')),
      entry NUMERIC NOT NULL,
      stop_loss NUMERIC NOT NULL,
      tp1 NUMERIC NOT NULL,
      tp2 NUMERIC NOT NULL,
      risk_reward NUMERIC NOT NULL,
      confidence NUMERIC NOT NULL,
      reasoning TEXT NOT NULL,
      market_snapshot JSONB,
      outcome TEXT CHECK (outcome IN ('WIN','LOSS','OPEN','BREAKEVEN')),
      result_r NUMERIC,
      closed_at TIMESTAMPTZ,
      is_demo BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_signals_5m_created_at ON signals_5m (created_at DESC);

    CREATE TABLE IF NOT EXISTS setup_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tipo TEXT NOT NULL CHECK (tipo IN ('sweep','displacement','bos','choch')),
      timeframe TEXT NOT NULL CHECK (timeframe IN ('M5','M30')),
      direzione TEXT NOT NULL CHECK (direzione IN ('rialzista','ribassista')),
      livello NUMERIC NOT NULL,
      candela_ts TIMESTAMPTZ NOT NULL,
      rilevato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
      stato TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (stato IN ('ACTIVE','INVALIDATED','EXPIRED')),
      chiuso_il TIMESTAMPTZ,
      motivo_chiusura TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_events_dedup
      ON setup_events (tipo, timeframe, direzione, candela_ts);
    CREATE INDEX IF NOT EXISTS idx_setup_events_stato ON setup_events (stato, rilevato_il DESC);

    -- M15 aggiunto quando la terna operativa e' passata da M5/M30/H1 a
    -- M5/M15/M30. 'H1' resta ammesso: in tabella possono esistere righe H1
    -- ancora ACTIVE scritte prima del passaggio, e devono poter essere
    -- invalidate o fatte scadere invece di violare il vincolo.
    -- ATTIVAZIONE DEL SEGNALE (02/09)
    --
    -- Un setup ICT ha l'entry sul bordo della zona di pullback, quindi il
    -- prezzo spesso deve ancora tornarci: e' un ordine limite. Prima il
    -- segnale nasceva gia' "attivo" e la notifica partiva subito, anche
    -- quando non c'era niente da eseguire.
    --
    -- Ora il segnale nasce IN ATTESA (attivato_il NULL, nessuna notifica) e
    -- viene attivato dal monitor nel ciclo in cui il prezzo tocca l'entry:
    -- e' li' che parte l'unica notifica. Se il prezzo non ci arriva entro la
    -- scadenza, il segnale muore senza aver mai disturbato nessuno.
    --
    -- Le righe gia' esistenti vengono considerate attivate alla creazione,
    -- cosi' lo storico resta coerente e le statistiche non cambiano.
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS attivato_il TIMESTAMPTZ;
    -- ATTENZIONE alla clausola sulla data: senza, questa UPDATE distrugge il
    -- meccanismo che dovrebbe abilitare.
    --
    -- ensureSchema() gira a OGNI ciclo, non una volta sola. Una UPDATE che
    -- filtra solo su "attivato_il IS NULL" colpisce esattamente i segnali IN
    -- ATTESA -- che hanno attivato_il nullo proprio perche' il prezzo non ha
    -- ancora toccato l'entry -- e li marca come attivati d'ufficio al primo
    -- ciclo dopo la nascita.
    --
    -- E' quello che e' successo dal 02/09 al 03/09: ogni segnale risultava
    -- attivato nello stesso istante in cui nasceva (zero minuti di attesa in
    -- tutte le righe), e la notifica partiva subito con un'entry che il
    -- prezzo doveva ancora raggiungere -- per esempio un SELL con entry
    -- 4432.36 notificato mentre il prezzo era 4429.99, cioe' 2,37 dollari
    -- sotto il livello da cui si sarebbe dovuto vendere.
    --
    -- Il limite temporale confina la migrazione al suo scopo vero: le righe
    -- gia' esistenti quando la colonna e' stata introdotta. I segnali nati
    -- dopo restano in attesa finche' e' il monitor ad attivarli davvero,
    -- guardando il prezzo.
    UPDATE signals SET attivato_il = created_at
      WHERE attivato_il IS NULL AND direction IN ('BUY','SELL')
        AND created_at < TIMESTAMPTZ '2026-09-02 18:00:00+00';

    ALTER TABLE setup_events DROP CONSTRAINT IF EXISTS setup_events_timeframe_check;
    ALTER TABLE setup_events ADD CONSTRAINT setup_events_timeframe_check
      CHECK (timeframe IN ('M5','M15','M30','H1'));

    CREATE TABLE IF NOT EXISTS market_context (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
      prezzo NUMERIC NOT NULL,
      firma TEXT NOT NULL,
      stato JSONB NOT NULL,
      transizione JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_market_context_creato_il ON market_context (creato_il DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Memoria persistente delle candele CHIUSE (M30/M15/M5). Tabella dedicata,
    -- separata da market_snapshots.raw: qui dentro vanno solo le candele,
    -- leggibili singolarmente, non un blob JSON di tutto lo snapshot.
    CREATE TABLE IF NOT EXISTS candle_memory (
      timeframe TEXT NOT NULL CHECK (timeframe IN ('M5','M15','M30','H1')),
      datetime TIMESTAMPTZ NOT NULL,
      open NUMERIC NOT NULL,
      high NUMERIC NOT NULL,
      low NUMERIC NOT NULL,
      close NUMERIC NOT NULL,
      inserita_il TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (timeframe, datetime)
    );
    CREATE INDEX IF NOT EXISTS idx_candle_memory_timeframe_datetime
      ON candle_memory (timeframe, datetime DESC);

    -- CREATE TABLE IF NOT EXISTS non tocca una tabella gia' esistente: senza
    -- questo ALTER, su un database gia' creato il vincolo resterebbe quello
    -- vecchio ('H1','M30','M5') e il primo INSERT di una candela M15
    -- fallirebbe. 'H1' resta ammesso per le righe gia' salvate, che la
    -- retention eliminera' da sola.
    ALTER TABLE candle_memory DROP CONSTRAINT IF EXISTS candle_memory_timeframe_check;
    ALTER TABLE candle_memory ADD CONSTRAINT candle_memory_timeframe_check
      CHECK (timeframe IN ('M5','M15','M30','H1'));
  `);
}

export async function savePushSubscription(endpoint: string, subscription: unknown) {
  const client = getPool();
  await client.query(
    `INSERT INTO push_subscriptions (endpoint, subscription)
     VALUES ($1, $2)
     ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription`,
    [endpoint, JSON.stringify(subscription)]
  );
}

export async function deletePushSubscription(endpoint: string) {
  const client = getPool();
  await client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function getAllPushSubscriptions() {
  const client = getPool();
  const res = await client.query(`SELECT endpoint, subscription FROM push_subscriptions`);
  return res.rows as { endpoint: string; subscription: any }[];
}

export async function insertSignal(signal: {
  direction: string;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskReward: number | null;
  confidence: number;
  reasoning: string;
  marketSnapshot?: unknown;
}) {
  const client = getPool();
  const entry = signal.entry ?? 0;
  const stopLoss = signal.stopLoss ?? 0;
  const tp1 = signal.tp1 ?? 0;
  const tp2 = signal.tp2 ?? 0;
  const riskReward = signal.riskReward ?? 0;
  const confidence = signal.confidence ?? 0;
  const reasoning = signal.reasoning ?? "Risposta AI incompleta: campo mancante.";
  const res = await client.query(
    // attivato_il valorizzato QUI, nello stesso INSERT (03/09).
    //
    // Il segnale nasce gia' ATTIVO: non esiste piu' nessuna attesa. Scriverlo
    // dentro l'INSERT invece che con una UPDATE separata toglie la finestra
    // in cui un segnale esisterebbe senza attivazione -- finestra che, se una
    // scrittura fallisse, lo farebbe trattare come "in attesa" al ciclo dopo,
    // resuscitando il blocco della generazione.
    `INSERT INTO signals
      (direction, entry, stop_loss, tp1, tp2, risk_reward, confidence, reasoning, market_snapshot, is_demo, attivato_il)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false, now())
     RETURNING id, created_at`,
    [
      signal.direction,
      entry,
      stopLoss,
      tp1,
      tp2,
      riskReward,
      confidence,
      reasoning,
      JSON.stringify(signal.marketSnapshot ?? {}),
    ]
  );
  return res.rows[0];
}

export async function insertMarketSnapshot(s: {
  xauusd: number;
  xauusdChangePct: number;
  dxy: number | null;
  dxyChangePct: number | null;
  us10y: number | null;
  us10yChangePct: number | null;
  [k: string]: unknown;
}) {
  const client = getPool();
  await client.query(
    `INSERT INTO market_snapshots (xauusd, xauusd_change_pct, dxy, dxy_change_pct, us10y, us10y_change_pct, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [s.xauusd, s.xauusdChangePct, s.dxy, s.dxyChangePct, s.us10y, s.us10yChangePct, JSON.stringify(s)]
  );
}

export async function insertContextSnapshot(news: unknown, calendar: unknown) {
  const client = getPool();
  await client.query(`INSERT INTO context_snapshots (news, calendar) VALUES ($1,$2)`, [
    JSON.stringify(news ?? []),
    JSON.stringify(calendar ?? []),
  ]);
}

export async function getLatestMarketSnapshot() {
  const client = getPool();
  // Niente SELECT *: la colonna raw contiene l'intero snapshot con tutte le
  // candele (decine di KB). Estraiamo solo il campo che serve davvero.
  const res = await client.query(
    `SELECT id, created_at, xauusd, xauusd_change_pct, dxy, dxy_change_pct, us10y, us10y_change_pct,
            raw->>'xauusdQuotedAt' AS xauusd_quoted_at
     FROM market_snapshots ORDER BY created_at DESC LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) return null;
  // Ricostruiamo la forma attesa dal resto dell'app senza trascinarci le candele.
  return { ...row, raw: { xauusdQuotedAt: row.xauusd_quoted_at ?? null } };
}

export async function getLatestContextSnapshot() {
  const client = getPool();
  const res = await client.query(`SELECT * FROM context_snapshots ORDER BY created_at DESC LIMIT 1`);
  return res.rows[0] ?? null;
}

// Stesso spartiacque di getStats: senza, lo storico visibile in dashboard
// mostrerebbe ancora i vecchi trade mischiati ai nuovi finche' non se ne
// accumulano 20 di nuovi -- le statistiche numeriche sarebbero pulite ma la
// lista sotto continuerebbe a far vedere la strategia precedente, il
// contrario di "ricontare da zero".
export async function getSignalHistory(limit = 20) {
  const client = getPool();
  const spartiacque = await getSetting("stats_da_il");
  const res = await client.query(
    `SELECT id, created_at, direction, entry, stop_loss, tp1, tp2, risk_reward,
            confidence, reasoning, outcome, result_r, closed_at
     FROM signals
     WHERE is_demo = false AND ($2::timestamptz IS NULL OR created_at >= $2)
     ORDER BY created_at DESC LIMIT $1`,
    [limit, spartiacque]
  );
  return res.rows;
}

// Solo per la diagnostica /api/debug/confronto: rilegge lo snapshot di
// mercato salvato con ogni segnale, per poter rigiocare la stessa decisione
// con il payload nuovo. Nessun altro punto dell'app deve usarla.
export async function getSegnaliConSnapshot(limit = 3) {
  const client = getPool();
  const res = await client.query(
    `SELECT id, created_at, direction, market_snapshot
       FROM signals
      WHERE market_snapshot IS NOT NULL
        AND direction IN ('BUY', 'SELL', 'NO_TRADE')
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return res.rows as Array<{
    id: string;
    created_at: string;
    direction: string;
    market_snapshot: Record<string, unknown>;
  }>;
}

export async function getLatestSignal() {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

// Segnali gia' ATTIVATI e ancora aperti: sono quelli che il monitor deve
// seguire per stop, target e scadenza.
export async function getSegnaleAttivo() {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals
     WHERE is_demo = false AND direction IN ('BUY','SELL')
       AND attivato_il IS NOT NULL AND outcome IS NULL
     ORDER BY attivato_il DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

// Segnali IN ATTESA: generati ma non ancora toccati dal prezzo. Non hanno
// mandato notifiche e non contano come trade aperto.
export async function getSegnaliInAttesa() {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals
     WHERE is_demo = false AND direction IN ('BUY','SELL')
       AND attivato_il IS NULL AND outcome IS NULL
     ORDER BY created_at ASC`
  );
  return res.rows;
}

// Il prezzo ha toccato l'entry: da qui il trade e' vivo e la notifica parte.
export async function attivaSegnale(id: string): Promise<void> {
  const client = getPool();
  await client.query(`UPDATE signals SET attivato_il = now() WHERE id = $1`, [id]);
}

// Il prezzo non e' mai tornato sull'entry entro la scadenza: il segnale muore
// senza essere mai stato un trade. Registrato come BREAKEVEN a 0R, perche'
// non ha guadagnato ne' perso nulla -- non e' mai partito.
export async function scadeSegnaleInAttesa(id: string, note: string): Promise<void> {
  const client = getPool();
  await client.query(
    `UPDATE signals SET outcome = 'BREAKEVEN', result_r = 0, closed_at = now(),
     reasoning = reasoning || $2 WHERE id = $1`,
    [id, note]
  );
}

export async function closeSignal(
  id: string,
  outcome: "WIN" | "LOSS" | "BREAKEVEN",
  resultR: number,
  note?: string
) {
  const client = getPool();
  if (note) {
    await client.query(
      `UPDATE signals SET outcome = $2, result_r = $3, closed_at = now(), reasoning = reasoning || $4 WHERE id = $1`,
      [id, outcome, resultR, note]
    );
  } else {
    await client.query(
      `UPDATE signals SET outcome = $2, result_r = $3, closed_at = now() WHERE id = $1`,
      [id, outcome, resultR]
    );
  }
}

// Le statistiche contano solo dallo SPARTIACQUE (impostazione
// "stats_da_il", vedi setSpartiacqueStatistiche). Il 02/09 e' cambiata la
// strategia -- narrativa H4/H1, setup M15, ICT completo, entry solo quando
// gia' eseguibile, attivazione al tocco del prezzo -- ed e' una logica
// diversa da quella con cui erano stati generati i segnali precedenti.
// Mescolarli avrebbe reso impossibile capire come si comporta la versione
// attuale: bastava un blocco di 73 righe orfane dell'entry, chiuse tutte
// insieme come LOSS l'1/9, a portare il totale storico da +65R a -8R.
//
// Lo spartiacque e' un'impostazione, non una cancellazione: lo storico
// resta tutto in tabella e resta consultabile per chi lo cerca
// esplicitamente (vedi getStats con includiStoricoPrecedente).
export async function getStats() {
  const client = getPool();
  const spartiacque = await getSetting("stats_da_il");
  // Query parametrizzata anche per un valore che non arriva mai da input
  // utente: e' l'unica forma sicura per costruire SQL con un valore
  // variabile, a prescindere da dove venga quel valore.
  const res = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_demo = false AND direction <> 'NO_TRADE' AND ($1::timestamptz IS NULL OR created_at >= $1)) AS total,
       COUNT(*) FILTER (WHERE is_demo = false AND outcome = 'WIN' AND ($1::timestamptz IS NULL OR created_at >= $1)) AS wins,
       COUNT(*) FILTER (WHERE is_demo = false AND outcome IN ('WIN','LOSS') AND ($1::timestamptz IS NULL OR created_at >= $1)) AS decided,
       AVG(risk_reward) FILTER (WHERE is_demo = false AND direction <> 'NO_TRADE' AND risk_reward > 0 AND ($1::timestamptz IS NULL OR created_at >= $1)) AS avg_rr
     FROM signals`,
    [spartiacque]
  );
  return res.rows[0];
}

export async function insertSignal5m(signal: {
  direction: string;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskReward: number | null;
  confidence: number;
  reasoning: string;
  marketSnapshot?: unknown;
}) {
  const client = getPool();
  const entry = signal.entry ?? 0;
  const stopLoss = signal.stopLoss ?? 0;
  const tp1 = signal.tp1 ?? 0;
  const tp2 = signal.tp2 ?? 0;
  const riskReward = signal.riskReward ?? 0;
  const confidence = signal.confidence ?? 0;
  const reasoning = signal.reasoning ?? "Risposta AI incompleta: campo mancante.";
  const res = await client.query(
    `INSERT INTO signals_5m
      (direction, entry, stop_loss, tp1, tp2, risk_reward, confidence, reasoning, market_snapshot, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
     RETURNING id, created_at`,
    [
      signal.direction,
      entry,
      stopLoss,
      tp1,
      tp2,
      riskReward,
      confidence,
      reasoning,
      JSON.stringify(signal.marketSnapshot ?? {}),
    ]
  );
  return res.rows[0];
}

export async function getSignalHistory5m(limit = 50) {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals_5m WHERE is_demo = false AND direction != 'NO_TRADE' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function getLatestSignal5m() {
  const client = getPool();
  const res = await client.query(
    `SELECT * FROM signals_5m WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

export async function closeSignal5m(
  id: string,
  outcome: "WIN" | "LOSS" | "BREAKEVEN",
  resultR: number,
  note?: string
) {
  const client = getPool();
  if (note) {
    await client.query(
      `UPDATE signals_5m SET outcome = $2, result_r = $3, closed_at = now(), reasoning = reasoning || $4 WHERE id = $1`,
      [id, outcome, resultR, note]
    );
  } else {
    await client.query(
      `UPDATE signals_5m SET outcome = $2, result_r = $3, closed_at = now() WHERE id = $1`,
      [id, outcome, resultR]
    );
  }
}

export async function getStats5m() {
  const client = getPool();
  const res = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_demo = false AND direction != 'NO_TRADE') AS total,
      COUNT(*) FILTER (WHERE is_demo = false AND outcome = 'WIN') AS wins,
      COUNT(*) FILTER (WHERE is_demo = false AND outcome IN ('WIN','LOSS')) AS decided,
      AVG(risk_reward) FILTER (WHERE is_demo = false AND direction <> 'NO_TRADE' AND risk_reward > 0) AS avg_rr
    FROM signals_5m
  `);
  return res.rows[0];
}

export async function getSetting(key: string): Promise<string | null> {
  const client = getPool();
  const res = await client.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return res.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const client = getPool();
  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

// MODALITA' SONNO
// La pausa e' manuale e SENZA SCADENZA: resta attiva finche' non viene tolta
// esplicitamente. Nessun timeout automatico: una pausa che si disattiva da
// sola fa ripartire le chiamate AI a pagamento senza che nessuno lo sappia.
// STRATEGIA ATTIVA (03/09): quali canali generano segnali.
//
//   "normale" -> solo il canale principale (setup M15, trade fino a 4 ore)
//   "veloce"  -> solo il canale veloce (trade da 10-30 minuti)
//
// UNA O L'ALTRA, MAI INSIEME. Non esiste una modalita' "entrambi": i due
// canali girerebbero in parallelo raddoppiando le chiamate AI, e
// soprattutto potresti ritrovarti due segnali contemporanei in direzioni
// diverse sullo stesso strumento.
//
// Il canale veloce era disattivato via codice: la sua rotta cron rispondeva
// "auto_disabled" senza guardare nulla. Ora la scelta e' un'impostazione, e
// si cambia dal pulsante in dashboard senza deploy.
export type StrategiaAttiva = "normale" | "veloce";

export async function getStrategiaAttiva(): Promise<StrategiaAttiva> {
  const v = await getSetting("strategia_attiva");
  return v === "veloce" ? "veloce" : "normale";
}

export async function setStrategiaAttiva(s: StrategiaAttiva) {
  await setSetting("strategia_attiva", s);
}

export async function isAiPaused(): Promise<boolean> {
  return (await getSetting("ai_paused")) === "true";
}

// Al risveglio viene alzato un flag: il ciclo successivo deve rifare
// un'analisi completa invece di riusare il setup precedente.
export async function setAiPaused(paused: boolean) {
  const eraInPausa = (await getSetting("ai_paused")) === "true";
  await setSetting("ai_paused", paused ? "true" : "false");
  if (paused) {
    await setSetting("ai_paused_at", new Date().toISOString());
  } else {
    await setSetting("ai_risvegliato_at", new Date().toISOString());
    if (eraInPausa) await setSetting("ai_refresh_al_risveglio", "true");
  }
}

// Stato minimo per /api/ticker: prezzo, variazione, orario e l'ultimo segnale
// di ogni canale. Poche decine di byte invece di centinaia di KB.
export async function getTickerState() {
  const client = getPool();
  const [snap, ultimo, ultimo5m] = await Promise.all([
    client.query(
      `SELECT xauusd, xauusd_change_pct, created_at, raw->>'xauusdQuotedAt' AS xauusd_quoted_at
       FROM market_snapshots ORDER BY created_at DESC LIMIT 1`
    ),
    // Solo segnali GIA' ATTIVATI: il SignalWatcher del browser avvisa quando
    // vede un id nuovo, e senza questo filtro avviserebbe alla nascita del
    // segnale -- cioe' mentre e' ancora in attesa che il prezzo torni
    // sull'entry, scavalcando tutto il meccanismo di attivazione. I NO_TRADE
    // restano inclusi: hanno attivato_il NULL ma non sono trade, e servono a
    // far vedere l'ultimo esito nel ticker.
    client.query(
      `SELECT id, direction, entry, confidence FROM signals
       WHERE is_demo = false
         AND (direction = 'NO_TRADE' OR attivato_il IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1`
    ),
    client.query(
      `SELECT id, direction, entry, confidence FROM signals_5m
       WHERE is_demo = false ORDER BY created_at DESC LIMIT 1`
    ),
  ]);
  const s = snap.rows[0] ?? null;
  return {
    prezzo: s?.xauusd !== undefined && s?.xauusd !== null ? Number(s.xauusd) : null,
    variazionePct:
      s?.xauusd_change_pct !== undefined && s?.xauusd_change_pct !== null
        ? Number(s.xauusd_change_pct)
        : null,
    snapshotCreatoIl: s?.created_at ?? null,
    quotatoIl: s?.xauusd_quoted_at ? Number(s.xauusd_quoted_at) : null,
    ultimoSegnale: ultimo.rows[0] ?? null,
    ultimoSegnale5m: ultimo5m.rows[0] ?? null,
  };
}

// --- memoria degli eventi di setup ---------------------------------------

export async function inserisciEventiSetup(
  eventi: { tipo: string; timeframe: string; direzione: string; livello: number; candelaTs: string }[]
): Promise<number> {
  if (eventi.length === 0) return 0;
  const client = getPool();
  let nuovi = 0;
  for (const e of eventi) {
    const res = await client.query(
      `INSERT INTO setup_events (tipo, timeframe, direzione, livello, candela_ts)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tipo, timeframe, direzione, candela_ts) DO NOTHING
       RETURNING id`,
      [e.tipo, e.timeframe, e.direzione, e.livello, e.candelaTs]
    );
    if (res.rowCount && res.rowCount > 0) nuovi += 1;
  }
  return nuovi;
}

export async function getEventiSetupAttivi() {
  const client = getPool();
  const res = await client.query(
    `SELECT id, tipo, timeframe, direzione, livello, candela_ts, rilevato_il
     FROM setup_events WHERE stato = 'ACTIVE' ORDER BY rilevato_il DESC LIMIT 40`
  );
  return res.rows;
}

export async function chiudiEventoSetup(id: string, stato: "INVALIDATED" | "EXPIRED", motivo: string) {
  const client = getPool();
  await client.query(
    `UPDATE setup_events SET stato = $2, chiuso_il = now(), motivo_chiusura = $3 WHERE id = $1`,
    [id, stato, motivo]
  );
}

// --- registro del contesto (audit, MAI fonte di verita') -------------------

export async function inserisciContesto(
  prezzo: number,
  firma: string,
  stato: unknown,
  transizione: unknown
) {
  const client = getPool();
  const res = await client.query(
    `INSERT INTO market_context (prezzo, firma, stato, transizione)
     VALUES ($1,$2,$3,$4) RETURNING id, creato_il`,
    [prezzo, firma, JSON.stringify(stato), JSON.stringify(transizione ?? null)]
  );
  return res.rows[0];
}

export async function getUltimoContesto() {
  const client = getPool();
  const res = await client.query(
    `SELECT id, creato_il, prezzo, firma, stato, transizione
     FROM market_context ORDER BY creato_il DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// MEMORIA CANDELE (M30 / M15 / M5)
//
// Solo infrastruttura: salva e rende rileggibili le candele CHIUSE dei tre
// timeframe operativi. Nessuna funzione qui dentro viene letta dalla strategia
// o dall'AI -- e' compito di chi la richiama decidere se e come usarla in
// futuro. Deliberatamente separata da market_snapshots.raw (che resta un
// blob JSON dell'intero snapshot, mai riletto candela per candela).
//
// H1 resta nel tipo e nella retention solo per le righe salvate prima del
// passaggio a M15: non viene piu' scritto, ma va ancora ripulito.
// ---------------------------------------------------------------------------

export type CandleMemoryTimeframe = "H1" | "M30" | "M15" | "M5";

export const CANDLE_MEMORY_RETENTION_MS: Record<CandleMemoryTimeframe, number> = {
  H1: 72 * 60 * 60 * 1000,
  M30: 48 * 60 * 60 * 1000,
  M15: 24 * 60 * 60 * 1000,
  M5: 12 * 60 * 60 * 1000,
};

export interface CandelaMemoria {
  timeframe: CandleMemoryTimeframe;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Inserisce solo candele CHIUSE (spetta al chiamante escludere quella ancora
// in formazione). La chiave (timeframe, datetime) fa da deduplicazione:
// una candela gia' presente viene ignorata silenziosamente, mai aggiornata.
// Ritorna quante candele erano davvero nuove.
export async function salvaCandeleMemoria(
  timeframe: CandleMemoryTimeframe,
  candele: { datetime: string; open: number; high: number; low: number; close: number }[]
): Promise<number> {
  if (!Array.isArray(candele) || candele.length === 0) return 0;
  const client = getPool();
  let nuove = 0;
  for (const c of candele) {
    const res = await client.query(
      `INSERT INTO candle_memory (timeframe, datetime, open, high, low, close)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (timeframe, datetime) DO NOTHING
       RETURNING timeframe`,
      [timeframe, c.datetime, c.open, c.high, c.low, c.close]
    );
    if (res.rowCount && res.rowCount > 0) nuove += 1;
  }
  return nuove;
}

// Elimina le candele piu' vecchie della retention del proprio timeframe.
// Senza argomento pulisce TUTTI i timeframe con la propria soglia.
//
// M15 era assente da questa lista pur essendo scritto a ogni ciclo: le sue
// righe non venivano mai cancellate e la tabella cresceva senza limite.
// La lista ora si ricava dalle chiavi della retention, cosi' aggiungere un
// timeframe in futuro non puo' piu' lasciarlo fuori dalla pulizia.
export async function pulisciCandeleMemoria(timeframe?: CandleMemoryTimeframe): Promise<void> {
  const client = getPool();
  const timeframes: CandleMemoryTimeframe[] = timeframe
    ? [timeframe]
    : (Object.keys(CANDLE_MEMORY_RETENTION_MS) as CandleMemoryTimeframe[]);
  for (const tf of timeframes) {
    const soglia = new Date(Date.now() - CANDLE_MEMORY_RETENTION_MS[tf]).toISOString();
    await client.query(`DELETE FROM candle_memory WHERE timeframe = $1 AND datetime < $2`, [tf, soglia]);
  }
}

// Legge la memoria di un timeframe in ordine cronologico (dalla piu' vecchia
// alla piu' recente). `limit`, se passato, prende le N candele piu' recenti
// mantenendo comunque l'ordine crescente in uscita.
export async function leggiCandeleMemoria(
  timeframe: CandleMemoryTimeframe,
  limit?: number
): Promise<CandelaMemoria[]> {
  const client = getPool();
  const res = limit
    ? await client.query(
        `SELECT * FROM (
           SELECT timeframe, datetime, open, high, low, close
           FROM candle_memory
           WHERE timeframe = $1
           ORDER BY datetime DESC
           LIMIT $2
         ) sub
         ORDER BY datetime ASC`,
        [timeframe, limit]
      )
    : await client.query(
        `SELECT timeframe, datetime, open, high, low, close
         FROM candle_memory
         WHERE timeframe = $1
         ORDER BY datetime ASC`,
        [timeframe]
      );

  return res.rows.map((r: { timeframe: string; datetime: string; open: string; high: string; low: string; close: string }) => ({
    timeframe: r.timeframe as CandleMemoryTimeframe,
    datetime: new Date(r.datetime).toISOString(),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}
