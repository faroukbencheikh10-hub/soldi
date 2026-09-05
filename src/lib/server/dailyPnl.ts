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

const DEFAULTS = {
  lot_size: 0.1,
  daily_target_eur: 400,
  daily_max_loss_eur: 150,
  eurusd_rate: 1.08,
} as const;

const SETTING_KEYS = [
  "lot_size",
  "daily_target_eur",
  "daily_max_loss_eur",
  "eurusd_rate",
] as const;

export type SettingsKey = (typeof SETTING_KEYS)[number];

export type DailySettings = {
  lot_size: number;
  daily_target_eur: number;
  daily_max_loss_eur: number;
  eurusd_rate: number;
};

export type DailyPnl = {
  pnlEur: number;
  trades: number;
  wins: number;
  losses: number;
  target: number;
  maxLoss: number;
  lotSize: number;
  finished: boolean;
};

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getSettings(): Promise<DailySettings> {
  const client = getPool();
  const res = await client.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key = ANY($1)`,
    [SETTING_KEYS.slice()]
  );
  const map = new Map(res.rows.map((row) => [row.key, row.value]));
  return {
    lot_size: parseNumber(map.get("lot_size"), DEFAULTS.lot_size),
    daily_target_eur: parseNumber(map.get("daily_target_eur"), DEFAULTS.daily_target_eur),
    daily_max_loss_eur: parseNumber(map.get("daily_max_loss_eur"), DEFAULTS.daily_max_loss_eur),
    eurusd_rate: parseNumber(map.get("eurusd_rate"), DEFAULTS.eurusd_rate),
  };
}

export async function updateSettings(
  patch: Partial<Record<SettingsKey, number>>
): Promise<DailySettings> {
  const client = getPool();
  const entries = (Object.entries(patch) as [SettingsKey, number][]).filter(
    ([key, value]) =>
      (SETTING_KEYS as readonly string[]).includes(key) &&
      typeof value === "number" &&
      Number.isFinite(value)
  );

  for (const [key, value] of entries) {
    await client.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]
    );
  }

  return getSettings();
}

export async function getDailyPnl(): Promise<DailyPnl> {
  const settings = await getSettings();
  const lotSize = settings.lot_size;
  const target = settings.daily_target_eur;
  const maxLoss = settings.daily_max_loss_eur;
  const rate = settings.eurusd_rate > 0 ? settings.eurusd_rate : DEFAULTS.eurusd_rate;

  const client = getPool();
  // Orario di chiusura: colonna `closed_at` (scritta da closeSignal /
  // scadeSegnaleInAttesa). Non esiste una colonna di prezzo di uscita.
  // Esiti chiusi usati in tabella: WIN, LOSS, BREAKEVEN (OPEN e NULL esclusi).
  const res = await client.query<{
    direction: string;
    entry: string | number;
    stop_loss: string | number;
    tp1: string | number;
    outcome: string;
    result_r: string | number | null;
  }>(
    `SELECT direction, entry, stop_loss, tp1, outcome, result_r
       FROM signals
      WHERE direction IN ('BUY', 'SELL')
        AND outcome IS NOT NULL
        AND upper(outcome) NOT IN ('OPEN')
        AND closed_at >= date_trunc('day', timezone('UTC', now())) AT TIME ZONE 'UTC'
        AND closed_at <  date_trunc('day', timezone('UTC', now())) AT TIME ZONE 'UTC' + interval '1 day'`
  );

  let pnlUsd = 0;
  let wins = 0;
  let losses = 0;

  for (const row of res.rows) {
    const direction = String(row.direction || "").toUpperCase();
    const outcome = String(row.outcome || "").toUpperCase();
    const entry = Number(row.entry);
    const stopLoss = Number(row.stop_loss);
    const tp1 = Number(row.tp1);
    const resultR =
      row.result_r === null || row.result_r === undefined ? null : Number(row.result_r);

    let tradeUsd = 0;
    const hasLevels = Number.isFinite(entry) && Number.isFinite(stopLoss);

    if (outcome === "WIN" && Number.isFinite(entry) && Number.isFinite(tp1)) {
      const raw = (tp1 - entry) * 100 * lotSize;
      tradeUsd = direction === "SELL" ? -raw : raw;
    } else if (outcome === "LOSS" && hasLevels) {
      const raw = (stopLoss - entry) * 100 * lotSize;
      tradeUsd = direction === "SELL" ? -raw : raw;
    } else if (resultR !== null && Number.isFinite(resultR) && hasLevels) {
      // Nessun prezzo di chiusura salvato (BREAKEVEN / scaduto / altro):
      // pnl_usd = R * |entry - stopLoss| * 100 * lot_size
      tradeUsd = resultR * Math.abs(entry - stopLoss) * 100 * lotSize;
    } else if (Number.isFinite(entry)) {
      tradeUsd = 0;
    }

    if (Number.isFinite(tradeUsd)) pnlUsd += tradeUsd;
    if (outcome === "WIN") wins += 1;
    if (outcome === "LOSS") losses += 1;
  }

  const pnlEur = round2(pnlUsd / rate);
  const finished = pnlEur >= target || pnlEur <= -maxLoss;

  return {
    pnlEur,
    trades: res.rows.length,
    wins,
    losses,
    target: round2(target),
    maxLoss: round2(maxLoss),
    lotSize,
    finished,
  };
}
