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

export async function getLastNoTrade(): Promise<{ ts: string; motivo: string } | null> {
  const res = await getPool().query(
    `SELECT ts, dettaglio FROM sett_log WHERE tipo = 'NO_TRADE' ORDER BY ts DESC LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) return null;
  const d = row.dettaglio && typeof row.dettaglio === "object" ? row.dettaglio : {};
  return {
    ts: String(row.ts),
    motivo: String((d as { motivo?: string }).motivo ?? "N/D"),
  };
}

export async function getContoSettimanaStats(): Promise<{
  wins: number;
  losses: number;
  parziali: number;
  settimaneConTrade: number;
  settimaneMappa: number;
}> {
  const client = getPool();
  const [t, m] = await Promise.all([
    client.query(`
      SELECT
        COUNT(*) FILTER (WHERE esito = 'WIN') AS wins,
        COUNT(*) FILTER (WHERE esito = 'LOSS') AS losses,
        COUNT(*) FILTER (WHERE esito = 'WIN_PARZIALE') AS parziali,
        COUNT(DISTINCT week_start) FILTER (
          WHERE esito IS NOT NULL AND esito <> 'NO_TRADE'
        ) AS settimane_con_trade
      FROM sett_trades
    `),
    client.query(`SELECT COUNT(DISTINCT week_start) AS n FROM sett_maps`),
  ]);
  const row = t.rows[0] ?? {};
  return {
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    parziali: Number(row.parziali) || 0,
    settimaneConTrade: Number(row.settimane_con_trade) || 0,
    settimaneMappa: Number(m.rows[0]?.n) || 0,
  };
}
