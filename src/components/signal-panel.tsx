import { TradeSignal } from "@/lib/types";
import { TrendingUp, TrendingDown, CircleSlash, ShieldAlert } from "lucide-react";
import { formatRecency } from "@/lib/formatTime";

// Riquadro di stato dell'ingresso: RIMOSSO (02/09).
//
// Mostrava "Eseguibile ora" e "Pullback saltato" confrontando prezzo ed
// entry. Tolto su richiesta: il pannello riporta gia' entry e prezzo, e il
// confronto si fa a colpo d'occhio.
//
// ATTENZIONE se lo si volesse ripristinare: la vecchia versione di questo
// commento diceva che "non esistono piu' ordini pendenti perche' il sistema
// emette solo segnali eseguibili al prezzo corrente". Non e' piu' vero --
// quella regola e' stata revocata. Oggi un segnale nasce IN ATTESA e diventa
// un trade solo quando il prezzo tocca l'entry: e' proprio quello che
// segnala il riquadro InAttesaDiAttivazione qui sotto.

// ---------------------------------------------------------------------------
// FINESTRA DI CHIUSURA ATTESA
//
// Non e' una previsione dell'esito ne' un filtro: dice solo QUANDO,
// statisticamente, il trade tende a chiudersi (stop o target toccato).
//
// I numeri vengono dai trade realmente chiusi in produzione (WIN + LOSS
// insieme, perche' quello che si stima e' la durata, non il risultato):
//   meta' dei trade chiude entro ~20 minuti
//   tre quarti entro ~1 ora
//   nove su dieci entro ~1h40
//
// Deliberatamente mostrata come INTERVALLO e non come orario secco: con una
// cinquantina di trade la variabilita' e' ancora alta, e un "chiudera' alle
// 21:38" comunicherebbe una precisione che i dati non hanno.
//
// Vanno riviste quando lo storico sara' piu' ampio: sono una fotografia del
// campione attuale, non una costante del mercato.
//
// Una precisazione sulla base statistica: questi minuti furono misurati
// dalla CREAZIONE alla chiusura, quando i due istanti coincidevano perche'
// il trade partiva subito. Ora il conteggio parte dall'ATTIVAZIONE, che e'
// il riferimento corretto (il trade esiste da li'), ma significa che i tre
// numeri qui sotto vanno riverificati sui trade nuovi: potrebbero risultare
// piu' corti, perche' non includono piu' l'attesa prima dell'ingresso.
const CHIUSURA_MEDIANA_MIN = 20;
const CHIUSURA_TIPICA_MAX_MIN = 61;
const CHIUSURA_QUASI_SEMPRE_MIN = 100;

function orario(dataIso: string, minutiDopo: number): string {
  const t = new Date(new Date(dataIso).getTime() + minutiDopo * 60000);
  if (isNaN(t.getTime())) return "—";
  return t.toLocaleTimeString("it-IT", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Un segnale non ancora attivato e' un ordine limite: il prezzo non ha
// toccato l'entry, non e' partita nessuna notifica, e se non ci arriva entro
// 90 minuti scade senza essere mai stato un trade.
//
// Senza questa riga il pannello lo mostrava identico a un trade in corso --
// stessi livelli, stesso esito vuoto -- e guardando l'app non c'era modo di
// sapere se il trade fosse vivo o solo in attesa. Solo visualizzazione:
// legge un campo che il monitor scrive gia' per conto suo.
function InAttesaDiAttivazione({ signal }: { signal: TradeSignal }) {
  if (signal.direction === "NO_TRADE" || signal.outcome) return null;
  if (signal.attivatoIl) return null;

  return (
    <div className="mb-3 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gold">In attesa</div>
      <p className="text-[11px] text-muted mt-1 leading-snug">
        Ordine limite a {signal.entry.toFixed(2)}: il prezzo non l&apos;ha ancora raggiunto, il
        trade non e&apos; partito. La notifica arriva quando lo tocca.
      </p>
    </div>
  );
}

function ChiusuraAttesa({ signal }: { signal: TradeSignal }) {
  // Solo per trade veri e ancora aperti: a esito noto la stima non serve piu'.
  if (signal.direction === "NO_TRADE" || signal.outcome) return null;

  // Niente stima finche' il trade non e' partito: un segnale in attesa non ha
  // ancora un orologio da far correre, e mostrare "chiusura attesa alle 22:21"
  // accanto al riquadro che dice "il trade non e' partito" sarebbe una
  // contraddizione. La stima parte dall'ATTIVAZIONE, non dalla creazione:
  // e' da li' che il trade esiste, ed e' da li' che i tempi dello storico
  // sono stati misurati.
  const riferimento = signal.attivatoIl;
  if (!riferimento || isNaN(new Date(riferimento).getTime())) return null;

  const trascorsi = Math.floor((Date.now() - new Date(riferimento).getTime()) / 60000);
  const oltreLaNorma = trascorsi > CHIUSURA_QUASI_SEMPRE_MIN;

  return (
    <div className="mb-3 rounded-lg border border-border bg-panel2 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">Chiusura attesa</div>
      {oltreLaNorma ? (
        <p className="text-[11px] text-muted mt-1 leading-snug">
          Aperto da {trascorsi} min, oltre la finestra abituale: nove trade su dieci
          si chiudono entro {CHIUSURA_QUASI_SEMPRE_MIN} minuti.
        </p>
      ) : (
        <>
          <div className="font-mono text-sm text-text mt-0.5">
            tra le {orario(riferimento, CHIUSURA_MEDIANA_MIN)} e le{" "}
            {orario(riferimento, CHIUSURA_TIPICA_MAX_MIN)}
          </div>
          <p className="text-[11px] text-muted mt-1 leading-snug">
            Meta&apos; dei trade chiude entro {CHIUSURA_MEDIANA_MIN} min, tre quarti entro
            un&apos;ora, nove su dieci entro {CHIUSURA_QUASI_SEMPRE_MIN} min (stima sullo
            storico, non una previsione dell&apos;esito).
          </p>
        </>
      )}
    </div>
  );
}

function DirectionBadge({ direction }: { direction: TradeSignal["direction"] }) {
  if (direction === "BUY")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-buy/15 text-buy px-3 py-1.5 text-sm font-semibold">
        <TrendingUp size={16} /> BUY
      </span>
    );
  if (direction === "SELL")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-sell/15 text-sell px-3 py-1.5 text-sm font-semibold">
        <TrendingDown size={16} /> SELL
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-panel2 text-muted px-3 py-1.5 text-sm font-semibold">
      <CircleSlash size={16} /> NO TRADE
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="desk-metric">
      <div className="desk-metric-label">{label}</div>
      <div className="desk-metric-value">{value}</div>
    </div>
  );
}

export function SignalPanel({ signal }: { signal: TradeSignal | null }) {
  if (!signal) {
    return (
      <div className="desk-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={16} className="text-muted" />
          <span className="desk-kicker">Segnale corrente</span>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-panel2 py-8 text-center">
          <p className="text-sm text-text font-medium">Agente non ancora collegato</p>
          <p className="text-xs text-muted mt-1 px-4">
            Nessun segnale live disponibile: connetti le fonti dati per iniziare l&apos;analisi.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="desk-card p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="desk-kicker">Segnale corrente</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted">{formatRecency(signal.createdAt)}</span>
          {signal.isDemo && (
            <span className="rounded-full bg-gold/15 text-gold px-2 py-0.5 text-[10px] font-semibold uppercase">
              Demo
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <DirectionBadge direction={signal.direction} />
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted">Confidence</div>
          <div className="font-mono text-lg font-semibold text-gold">{signal.confidence}%</div>
        </div>
      </div>

      <InAttesaDiAttivazione signal={signal} />
      <ChiusuraAttesa signal={signal} />

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Metric label="Entry" value={signal.entry.toFixed(2)} />
        <Metric label="Stop Loss" value={signal.stopLoss.toFixed(2)} />
        <Metric label="R:R" value={signal.riskReward.toFixed(1)} />
        <Metric label="TP1" value={signal.tp1.toFixed(2)} />
        <Metric label="TP2" value={signal.tp2.toFixed(2)} />
        <Metric label="Esito" value={signal.outcome ?? "—"} />
      </div>

      <div className="rounded-lg bg-panel2 border border-border px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted mb-1">Spiegazione</div>
        <p className="text-xs text-text leading-relaxed">{signal.reasoning}</p>
      </div>
    </div>
  );
}
