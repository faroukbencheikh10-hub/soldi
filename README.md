# Soldi

## Trade della settimana

Modulo isolato dall'intraday: un solo XAUUSD lun–ven, eseguito a mano su MT5. L'app genera il segnale e misura l'esito.

- Branch di lavoro: `trade-settimana` (anteprima Vercel prima del merge).
- Tabelle Neon `sett_*` (script `sql/sett_migration.sql`). Lock in `settings`: `sett_lock`, `sett_last_done_at`, `sett_last_error`.
- Cron dedicato: `GET /api/cron/settimana?secret=$CRON_SECRET` ogni ora su cron-job.org. Non usa il cron Vercel né `analyze_lock`.
- API: `/api/settimana/state`, `/api/settimana/history`, `POST /api/settimana/close`, `POST /api/settimana/live`.
- Nessuna env nuova. Riusa `OPENAI_MODEL`, `SPREAD_BUFFER`, `CRON_SECRET`, MetaApi/Twelve Data, Finnhub, news CNBC.
- Max 2 chiamate AI a settimana + 1 se la mappa viene invalidata su chiusura H4.
- Dashboard: sezione sotto Contesto Macro. Il trade è sempre virtuale; «Aperto in live» è solo informativo.
