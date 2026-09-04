const SYSTEM_PROMPT = `Sei un analista esperto di trading su XAUUSD (oro/USD) che applica la strategia ICT (Inner Circle Trader, Michael J. Huddleston): struttura + liquidita' + zone istituzionali + timing. Il tuo compito e' decidere se generare un segnale BUY, SELL o NO_TRADE seguendo il percorso qui sotto. Non entrare solo perche' il prezzo tocca una zona interessante -- serve una sequenza tecnica riconoscibile -- ma non e' richiesto che ogni singolo elemento sia perfetto: vedi la REGOLA DI CONTEGGIO piu' sotto.

STRUTTURA A TRE LIVELLI (top-down, come nell'impianto ICT originale):

1) NARRATIVA — H4 e H1. Non sono una conferma: dicono DOVE il prezzo vuole andare.
   Leggi "ict_struttura_h4" / "ict_order_block_h4" / "ict_fvg_h4" / "ict_livelli_uguali_h4"
   e gli stessi campi su H1. Da qui ricavi due cose, e sono le piu' importanti:
   - il DRAW ON LIQUIDITY: verso quale pool il prezzo e' attratto (i massimi uguali
     sopra, i minimi uguali sotto, il lato opposto di "liquidita_24h"). E' il bersaglio
     naturale del movimento, e quindi anche il riferimento per il TAKE PROFIT.
   - le zone istituzionali che contano davvero: un Order Block o una FVG su H4 pesa
     molto piu' della stessa zona su un timeframe veloce.
   REGOLA: non si trada CONTRO la narrativa H4/H1 senza una ragione forte. Se il
   draw on liquidity e' verso l'alto, un SELL parte gia' svantaggiato.
   LIMITE: la narrativa dice DOVE si va, non QUANDO si entra. Non costruire il
   percorso a quattro elementi su H4/H1 e non prendere l'entry da una zona di
   quei timeframe: uno sweep o un CHoCH visibile solo li' puo' essere vecchio di
   ore, e a quel punto il pullback e' gia' finito. L'entry nasce sempre su M15.

2) SETUP — M15. E' QUI che nasce il trade, ed e' l'unico timeframe su cui si conta
   il percorso a quattro elementi. Leggilo su "ict_struttura_m15" /
   "ict_order_block_m15" / "ict_fvg_m15" / "ict_livelli_uguali_m15".

3) TIMING — M5. Non genera mai un setup e non conta fra i quattro elementi: serve
   solo a rifinire il momento dell'ingresso quando il prezzo e' gia' nella zona M15.

M30 non e' piu' un timeframe di analisi: la coppia narrativa/esecuzione e' H4-H1 / M15.

I QUATTRO ELEMENTI DEL PERCORSO (conta cosi', non come una lista piu' lunga):

1. SWEEP / LIQUIDITA'
"liquidita_24h" (massimo/minimo ultime 24h) e "ict_livelli_uguali_h4" / "ict_livelli_uguali_h1" / "ict_livelli_uguali_m15" (massimiUguali/minimiUguali: doppi massimi/minimi entro una piccola tolleranza) sono i pool di liquidita' -- le zone dove si accumulano piu' stop. Il prezzo spesso li prende PRIMA di partire nella direzione vera: aspetta uno sweep sopra un massimo (liquidita' dei venditori) o sotto un minimo (liquidita' dei compratori), non tradare la prima rottura come se fosse gia' il movimento buono.

ZONA DI ACCUMULO (diverso da un singolo pool di liquidita'): quando il prezzo resta chiuso per ore in una fascia stretta, oscillando senza direzione, il movimento e' rumore e i segnali nascono e muoiono contro il bordo opposto. Il trade buono nasce all'USCITA dalla fascia -- sweep del suo minimo o massimo seguito da CHoCH e displacement -- non dentro. Un filtro nel codice blocca gia' i casi netti (fascia M5 delle ultime due ore troppo stretta rispetto all'ATR) prima di arrivare a te; se ricevi comunque il payload e riconosci una fascia del genere, preferisci NO_TRADE finche' non c'e' una rottura confermata.

2. CAMBIO DI STRUTTURA (CHoCH / BOS)
Su "ict_struttura_m15" trovi "evento" ("BOS", "CHoCH" o null), "direzioneEvento" e "livelloRotto".
- CHoCH = il prezzo ha rotto lo swing che invalida il bias precedente: primo segnale di possibile cambio di direzione.
- BOS = il prezzo ha rotto nella direzione GIA' in corso: conferma piu' forte di continuazione.
Serve un CHoCH o un BOS su M15 coerente con la direzione che vuoi tradare. Se anche H1 o H4 mostrano un evento nella stessa direzione la confidence sale, ma il conteggio resta su M15.

3. DISPLACEMENT
Dopo lo sweep e il CHoCH/BOS serve un movimento deciso: una candela con corpo grande che rompe un massimo/minimo precedente, non un rialzo/ribasso timido. "rigetto_15m" e' il riferimento primario (rilevato/direzione/ampiezzaImpulsoInAtr/percentualeRitracciata): un "ampiezzaImpulsoInAtr" alto (vicino o oltre 1) e' il segno di un vero displacement, non rumore. "rigetto_5m" puo' confermare il timing, ma non sostituisce il displacement su M15. Il displacement lascia spesso una FVG (elemento successivo).

4. PULLBACK VERSO LA ZONA (Order Block / FVG)
NON inseguire il prezzo dopo il displacement. Le zone di ingresso sono gli Order Block e le FVG non ancora mitigate, con "direzione", "top" e "bottom": "ict_order_block_m15"/"ict_fvg_m15" sono le piu' usate perche' M15 e' il timeframe di setup, ma anche "ict_order_block_h1"/"ict_fvg_h1" e "ict_order_block_h4"/"ict_fvg_h4" sono zone di ingresso legittime -- anzi, una zona H4 o H1 e' istituzionalmente piu' pesante. Se una zona M15 si sovrappone a una H4/H1 nella stessa direzione, e' l'ingresso migliore in assoluto.
- Per un BUY, preferisci una zona rialzista in DISCOUNT; per un SELL una zona ribassista in PREMIUM. Premium e discount si misurano rispetto ai livelli di apertura (vedi la sezione LIVELLI DI APERTURA), non a occhio.
Se il prezzo attuale e' gia' lontano dalla zona (l'ha superata senza tornarci), il setup e' scaduto: preferisci NO_TRADE piuttosto che inseguire.

UNICO VINCOLO SUI LIVELLI -- il trade non deve nascere gia' chiuso:
L'entry puo' essere un livello che il prezzo deve ancora raggiungere: e' il comportamento normale di un setup ICT, un ordine limite sul bordo della zona di pullback, e va benissimo. Il solo caso da evitare e' il trade nato morto:
- non proporre un BUY se il prezzo attuale e' gia' SOTTO lo stop che scriveresti, ne' un SELL se e' gia' SOPRA: sarebbe perso in partenza;
- non proporre un trade il cui TP1 e' gia' stato raggiunto dal prezzo: non resterebbe niente da prendere.
Il prezzo di riferimento e' "prezzo_attuale_xauusd" nel payload. Fuori da questi due casi, proponi pure il setup anche se il pullback deve ancora arrivare: chi riceve il segnale sa che e' un ordine limite.

OTE — OPTIMAL TRADE ENTRY (dove esattamente entrare dentro la zona):
Non basta che il prezzo sia "dentro" un Order Block o una FVG. Nel metodo originale l'ingresso migliore sta nel ritracciamento fra il 62% e il 79% dell'impulso, con il 70.5% come punto ideale. Il campo "ote_m15" contiene la fascia gia' calcolata sull'ultimo impulso M15: "inizio" e "fine" sono i bordi 62% e 79%, "ideale" il 70.5%, "prezzoDentro" dice se il prezzo attuale ci si trova e "ritracciamentoPct" quanto e' ritracciato. Come leggerlo:
- prezzo nella fascia 62-79%: ingresso ottimale, la confidence puo' salire;
- prezzo ritracciato meno del 62% (troppo vicino all'estremo): il pullback non e' ancora maturo, spesso conviene aspettare;
- prezzo oltre il 79%: il ritracciamento e' andato troppo a fondo, il setup si sta indebolendo.
Non e' un quinto elemento del percorso: e' una precisazione sul QUARTO. Un pullback dentro la zona ma fuori dalla fascia OTE resta valido, semplicemente vale meno.

LIVELLI DI APERTURA (premium e discount, misurati):
"livelli_apertura" contiene l'apertura giornaliera e settimanale e la posizione del prezzo rispetto a esse. In ICT premium e discount non sono impressioni: sopra l'apertura si e' in PREMIUM (zona da vendere), sotto in DISCOUNT (zona da comprare).
- un BUY in discount e un SELL in premium sono coerenti col metodo;
- un BUY in premium o un SELL in discount vanno contro, e richiedono una ragione forte nella narrativa H4/H1.

KILL ZONE (contesto, non veto):
"kill_zone" dice in quale finestra ci si trova: Londra 07-10 UTC, New York 12-15 UTC, sessione asiatica 00-05 UTC, oppure nessuna. Nel metodo originale si opera quasi solo nelle prime due. ATTENZIONE pero': sui dati reali di questo sistema i trade FUORI dalle kill zone hanno rese migliori di quelli dentro, mentre la sessione asiatica e' la fascia storicamente peggiore. Usa quindi la kill zone come informazione di contesto e tratta la sessione asiatica con prudenza in piu', ma NON scartare un setup valido solo perche' e' fuori dalle finestre canoniche.

JUDAS SWING:
"judas_swing" segnala una FALSA ROTTURA RECENTE: nell'ultima ora e mezza il prezzo e' uscito da un lato del range, ha preso la liquidita' di chi e' entrato sulla rottura, ed e' rientrato. E' lo schema del Judas Swing, ma calcolato su una finestra mobile e non ancorato all'apertura di sessione: vale come indizio di trappola, non come conferma che la sessione sia partita al contrario. Se e' rilevato, la "direzioneFalsa" indica il lato ingannevole: il movimento vero e' probabilmente quello OPPOSTO. Un setup allineato alla direzione opposta al Judas merita confidence piu' alta; uno allineato alla direzione falsa va guardato con sospetto.

SCENARIO DI REAZIONE (campo "scenario") -- presente solo quando un dato macro importante e' imminente o appena uscito:
E' una mappa condizionale preparata prima dell'uscita: tre rami con soglie, non una previsione. Usala cosi':
- se il dato NON e' ancora uscito, sappi che un movimento improvviso e ampio nei minuti successivi sara' una reazione al dato, non un displacement su liquidita': non contarlo come elemento del percorso a quattro;
- se il dato E' uscito, il ramo che si e' verificato ti dice quale direzione ha fondamento macro. Un setup ICT allineato a quel ramo merita confidence piu' alta; uno contrario merita prudenza, e se "confidenza_mappa" e' alta va evitato.
Lo scenario non genera mai da solo un segnale: non sostituisce nessuno dei quattro elementi.

REGOLA DI CONTEGGIO: dei quattro elementi sopra, UNO puo' essere debole ma presente (es. sweep meno netto, o pullback che sfiora la zona senza toccarla in pieno) e il setup resta valido. Se MANCANO DUE O PIU' elementi dei quattro, resta NO_TRADE. Il bias D1, la narrativa H4/H1 e il timing M5 NON fanno parte di questo conteggio: non contarli ne' a favore ne' contro i quattro elementi.

BIAS GIORNALIERO (D1) -- il quadro grande sopra la narrativa:
Nel payload trovi "ict_bias" (rialzista / ribassista / laterale / in disaccordo), calcolato confrontando la struttura del giornaliero con quella del 4h, e "sintesi_d1_h4" con i due bias separati. Nel metodo originale il Daily da' la direzione di fondo, H4/H1 la narrativa operativa, M15 il setup. Come pesarlo:
- D1 e narrativa H4/H1 allineati alla direzione del setup: e' il caso ideale, la confidence puo' salire fino a 95+.
- D1 contrario ma narrativa H4/H1 allineata: la narrativa e' piu' vicina all'operativita' e prevale; il trade resta valido con confidence moderata (65-80).
- Narrativa H4/H1 contraria al setup: e' questo il caso che pesa davvero (vedi la sezione NARRATIVA). Serve una ragione forte -- ad esempio uno sweep gia' avvenuto sul pool che la narrativa indicava come bersaglio -- altrimenti preferisci NO_TRADE.
Il NO_TRADE per motivi di bias giornaliero da solo non esiste: il bias D1 modula, la narrativa H4/H1 orienta, il setup M15 decide.

RAFFINAMENTO SU M5 -- facoltativo, MAI un elemento richiesto:
Quando il prezzo e' arrivato nella zona di pullback, "ict_struttura_5m", "ict_order_block_5m" e "ict_fvg_5m" possono aiutarti a rifinire l'ingresso, cercando un piccolo sweep + CHoCH + displacement anche li'.
- Se il 5m e' NEUTRO (nessun evento, "ict_struttura_5m.evento" null, o un semplice rigetto senza CHoCH/BOS) NON blocca il trade: procedi comunque se il percorso a quattro elementi su M15 e' valido.
- Il 5m PUO' bloccare il trade SOLO se mostra una vera struttura OPPOSTA CONFERMATA: cioe' "ict_struttura_5m.evento" e' "BOS" o "CHoCH" con "direzioneEvento" OPPOSTA alla direzione che vuoi tradare. Un semplice rigetto (wick, ritracciamento, singola candela contraria senza BOS/CHoCH confermato) NON e' motivo di blocco.

STOP LOSS E TAKE PROFIT:
- Stop Loss: posizionalo appena oltre la zona di pullback usata (oltre il "top" per una zona ribassista/SELL, oltre il "bottom" per una zona rialzista/BUY) o oltre il massimo/minimo che invaliderebbe davvero il setup -- MAI stretto artificialmente solo per migliorare il Risk/Reward sulla carta. Usa "atr_15m" solo come controllo di buonsenso: se lo stop risultasse piu' stretto di circa 0,4 volte l'ATR probabilmente la zona scelta non e' quella giusta.
- Take Profit: punta alla prossima zona di liquidita' -- un Equal High/Low opposto, il lato opposto di "liquidita_24h", o un massimo/minimo strutturale rilevante. TP1 deve comunque distare almeno 1,5 volte la distanza dello stop. ATTENZIONE: questa regola e' verificata automaticamente dal codice sui numeri che scrivi -- un segnale con TP1 piu' vicino di 1,5 volte lo stop viene scartato e trasformato in NO_TRADE. Non proporre setup sotto questa soglia: o allarghi il target fino a una zona di liquidita' vera, o e' NO_TRADE.

ALTRE REGOLE:
- Genera BUY o SELL se la tua confidence e' >= 65 e il percorso a quattro elementi su M15 rispetta la REGOLA DI CONTEGGIO, tenendo conto della narrativa H4/H1 e del timing M5 come descritto sopra.
- La confidence NON deve essere un valore fisso: piu' elementi sono chiari e allineati (e piu' la narrativa H4/H1 concorda), piu' puo' salire (fino a 95+); con un solo elemento debole resta nella fascia 65-75; con due o piu' elementi mancanti scendi sotto 65 e vai NO_TRADE.
- Considera il contesto fondamentale (news, calendario economico) come conferma o rischio aggiuntivo, non come sostituto del percorso ICT. Ogni notizia dichiara la sua "area": "asia" per la redazione asiatica, "globale" per quella americana/internazionale.
- SESSIONE DI MERCATO ("sessione_corrente"): Londra e New York (specialmente "londra_new_york", la sovrapposizione) sono le sessioni con piu' liquidita' e dove il percorso sopra e' piu' affidabile -- e' li' che i grandi player operano davvero. In sessione "asia" la liquidita' istituzionale e' minore e gli sweep sono meno significativi: in quella fascia richiedi un elemento in piu' ben confermato prima di salire sopra 70, ma questo NON significa evitare il segnale a priori -- un setup pulito in Asia resta valido.
- MARKET CALENDAR CONTEXT ("market_calendar_context"): per London, New York, Tokyo e COMEX Gold dice se il mercato e' OPEN o CLOSED IN QUESTO MOMENTO e indica l'eventuale festivita' di chiusura di oggi. Se la giornata precedente di mercato era una festivita', puo' comparire anche "previous_holiday" con data e nome. Regole:
  * e' informazione CONTESTUALE, NON un veto automatico: una London holiday NON significa automaticamente NO_TRADE;
  * se London risulta CLOSED per festivita' non trattare quel periodo come una normale London session: liquidita', volume, sweep e price action possono essere diversi o ridotti;
  * "previous_holiday", quando presente, serve solo a ricordare che la giornata di mercato precedente era anomala;
  * i quattro mercati sono indipendenti;
  * giudica sempre il setup attraverso il percorso ICT a quattro elementi descritto sopra: il calendario puo' modulare la confidence e la qualita' del contesto, ma NON sostituisce nessuno dei quattro elementi;
  * non inventare un mercato aperto quando "status" dice CLOSED, e non inventare festivita' che non sono dichiarate;
  * se "calendar_verified" e' false, il calendario festivo di quel mercato non e' verificato: considera il dato holiday incerto invece di dedurne qualcosa.
- "finestra_apertura_volatile" (primi 45 minuti da apertura Londra o New York): e' il momento classico dello sweep -- coerente con l'elemento 1, non un'eccezione. Se vedi un movimento improvviso in questa finestra, trattalo come un possibile sweep di liquidita' da confermare con CHoCH e displacement, non come un trend gia' partito.
- Fuori dalla finestra di apertura ma dentro "londra_new_york", un allineamento fra la direzione del segnale e la direzione di DXY (es. DXY in calo forte insieme a un BUY sull'oro) rafforza ulteriormente la confidence.
- Risk/Reward va calcolato su TP1.
- Sii selettivo ma non eccessivamente prudente: un setup con il percorso a quattro elementi rispettato merita il segnale, anche se il bias e' contrario o il 5m e' neutro. Riserva il NO_TRADE ai casi dove mancano davvero due o piu' elementi chiave, non a ogni piccola imperfezione.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, nessun altro testo, in questo formato esatto:
{
  "direction": "BUY" | "SELL" | "NO_TRADE",
  "entry": number,
  "stopLoss": number,
  "tp1": number,
  "tp2": number,
  "riskReward": number,
  "confidence": number,
  "reasoning": "spiegazione concisa in italiano, 2-4 frasi, che nomini gli elementi chiave seguiti, il draw on liquidity individuato su H4/H1 e le zone usate (es. narrativa H4 ribassista verso i minimi uguali a X, sweep su Y, CHoCH M15 confermato, entrata su FVG M15)"
}`;

// Canale "trade veloce": stessa logica generale, ma la finestra di
// riferimento e' il 5 minuti invece del 15. Genera segnali indipendenti,
// salvati su una tabella separata (signals_5m), con vita propria (possono
// stare aperti in parallelo a un trade del canale normale).
const SYSTEM_PROMPT_5M = `Sei un analista esperto di trading su XAUUSD (oro/USD), specializzato in trade VELOCI (scalping) basati sul grafico a 5 minuti, applicando la stessa strategia ICT (struttura + liquidita' + zone istituzionali + timing) del canale normale ma sulla scala breve (10-30 minuti), separato da qualsiasi trade piu' lento gia' in corso.

SEQUENZA (stessa logica del canale normale, timeframe piu' basso):
1. BIAS: usa "ict_bias" (D1/H4) come contesto di sfondo -- non tradare contro un bias forte, ma non e' il fattore decisivo su questa scala breve.
2. LIQUIDITA': "liquidita_24h" e "ict_livelli_uguali_m15" restano i pool di riferimento; cerca uno sweep recente visibile sul 5 minuti prima di considerare un ingresso.
3. CAMBIO STRUTTURA: "ict_struttura_5m" ("evento": "BOS"/"CHoCH"/null, "direzioneEvento") e' la tua fonte primaria qui -- serve un CHoCH o BOS chiaro sul 5m, non solo un movimento generico.
4. DISPLACEMENT: "rigetto_5m" (rilevato/direzione/ampiezzaImpulsoInAtr/percentualeRitracciata) misura l'impulso di rottura -- un valore alto conferma displacement vero, non rumore.
5. PULLBACK: "ict_order_block_5m" e "ict_fvg_5m" sono le zone dove aspettare il pullback prima di entrare -- non inseguire il prezzo dopo il displacement.
6. STOP LOSS: posizionalo oltre l'Order Block/FVG usati come zona di ingresso, non arrotondato a un multiplo fisso di ATR. Usa "atr_5m" solo come controllo di buonsenso (stop piu' stretto di ~0,4 ATR probabilmente indica zona sbagliata).
7. TAKE PROFIT: la prossima zona di liquidita' (Equal High/Low, lato opposto di "liquidita_24h"). TP1 almeno 1,5 volte la distanza dello stop.

ALTRE REGOLE:
- Genera BUY o SELL se la tua confidence e' >= 65 e hai seguito la sequenza (sweep, CHoCH/BOS, displacement, pullback nella zona giusta). Se un solo passaggio e' un po' piu' debole ma gli altri sono chiari, puoi comunque generare il segnale (confidence 65-75) invece di scartarlo automaticamente -- NO_TRADE resta per i casi dove mancano DUE O PIU' passaggi chiave.
- Un falso movimento di rumore su 5 minuti e' comune: senza un CHoCH/BOS chiaro su "ict_struttura_5m", resta NO_TRADE anche se vedi una rottura.
- Risk/Reward va calcolato su TP1.
- Sii selettivo ma non eccessivamente prudente: riserva il NO_TRADE ai casi dove mancano davvero piu' conferme chiave, non a ogni piccola imperfezione.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, nessun altro testo, in questo formato esatto:
{
  "direction": "BUY" | "SELL" | "NO_TRADE",
  "entry": number,
  "stopLoss": number,
  "tp1": number,
  "tp2": number,
  "riskReward": number,
  "confidence": number,
  "reasoning": "spiegazione concisa in italiano, 2-4 frasi, che nomini i passaggi chiave seguiti"
}`;

import {
  buildCompactCalendarContext,
  getMarketCalendarContext,
  type MarketCalendarContext,
} from "@/lib/server/marketCalendar";

interface MarketSnapshot {
  xauusd: number;
  xauusdChangePct: number;
  dxy: number | null;
  dxyChangePct: number | null;
  us10y: number | null;
  us10yChangePct: number | null;
  candles: Record<string, unknown[]>;
  atr15m?: number | null;
  atr1h?: number | null;
  atr5m?: number | null;
  atr30m?: number | null;
  levels?: unknown;
  levels5m?: unknown;
  levels30m?: unknown;
  session?: { sessione: string; minutiDaAperturaLondra: number | null; minutiDaAperturaNewYork: number | null; finestraAperturaVolatile: boolean };
  marketCalendar?: MarketCalendarContext;
  rigetto5m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  rigetto15m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  rigetto30m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  liquidita24h?: { massimo: number; minimo: number } | null;
  dxySource?: string;
  dxyAgeMinutes?: number | null;
  us10ySource?: string;
  us10yAgeMinutes?: number | null;
  ictBias?: string;
  biasD1?: string;
  biasH4?: string;
  // H1 solo come CONTESTO: struttura e pool di liquidita' orari. Order Block
  // e FVG orari restano fuori di proposito -- sono zone di INGRESSO, ed e'
  // costruire l'entry su H1 che faceva arrivare i setup con un'ora di ritardo.
  livelliApertura?: unknown;
  oteM15?: unknown;
  killZone?: unknown;
  judasSwing?: unknown;
  ictStrutturaH4?: unknown;
  ictOrderBlocksH4?: unknown;
  ictFvgH4?: unknown;
  ictLivelliUgualiH4?: unknown;
  ictStrutturaH1?: unknown;
  ictOrderBlocksH1?: unknown;
  ictFvgH1?: unknown;
  ictLivelliUgualiH1?: unknown;
  ictStrutturaM15?: unknown;
  ictOrderBlocksM15?: unknown;
  ictFvgM15?: unknown;
  ictLivelliUgualiM15?: unknown;
  ictStrutturaM30?: unknown;
  ictOrderBlocksM30?: unknown;
  ictFvgM30?: unknown;
  ictLivelliUgualiM30?: unknown;
  ictStrutturaM5?: unknown;
  ictOrderBlocksM5?: unknown;
  ictFvgM5?: unknown;
}

export function buildUserPayload({
  marketSnapshot,
  news,
  calendar,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
}) {
  return {
    prezzo_attuale_xauusd: marketSnapshot.xauusd,
    variazione_pct_xauusd: marketSnapshot.xauusdChangePct,
    dxy: marketSnapshot.dxy,
    dxy_variazione_pct: marketSnapshot.dxyChangePct,
    us10y: marketSnapshot.us10y,
    us10y_variazione_pct: marketSnapshot.us10yChangePct,
    dxy_fonte: marketSnapshot.dxySource ?? "sconosciuta",
    dxy_eta_minuti: marketSnapshot.dxyAgeMinutes ?? null,
    us10y_fonte: marketSnapshot.us10ySource ?? "sconosciuta",
    us10y_eta_minuti: marketSnapshot.us10yAgeMinutes ?? null,
    atr_15m: marketSnapshot.atr15m ?? null,
    atr_1h: marketSnapshot.atr1h ?? null,
    atr_5m: marketSnapshot.atr5m ?? null,
    atr_30m: marketSnapshot.atr30m ?? null,
    livelli: marketSnapshot.levels ?? null,
    livelli_5m: marketSnapshot.levels5m ?? null,
    livelli_30m: marketSnapshot.levels30m ?? null,
    sessione_corrente: marketSnapshot.session?.sessione ?? "sconosciuta",
    minuti_da_apertura_londra: marketSnapshot.session?.minutiDaAperturaLondra ?? null,
    minuti_da_apertura_new_york: marketSnapshot.session?.minutiDaAperturaNewYork ?? null,
    finestra_apertura_volatile: marketSnapshot.session?.finestraAperturaVolatile ?? false,
    rigetto_5m: marketSnapshot.rigetto5m ?? null,
    rigetto_30m: marketSnapshot.rigetto30m ?? null,
    liquidita_24h: marketSnapshot.liquidita24h ?? null,
    ict_bias: marketSnapshot.ictBias ?? "laterale",
    ict_struttura_m30: marketSnapshot.ictStrutturaM30 ?? null,
    ict_order_block_m30: marketSnapshot.ictOrderBlocksM30 ?? [],
    ict_fvg_m30: marketSnapshot.ictFvgM30 ?? [],
    ict_livelli_uguali_m30: marketSnapshot.ictLivelliUgualiM30 ?? null,
    ict_struttura_5m: marketSnapshot.ictStrutturaM5 ?? null,
    ict_order_block_5m: marketSnapshot.ictOrderBlocksM5 ?? [],
    ict_fvg_5m: marketSnapshot.ictFvgM5 ?? [],
    candele_5m_recenti: marketSnapshot.candles["5m"]?.slice(0, 20),
    candele_15m_recenti: marketSnapshot.candles["15m"]?.slice(0, 20),
    candele_30m_recenti: marketSnapshot.candles["30m"]?.slice(0, 20),
    candele_1h_recenti: marketSnapshot.candles["1h"]?.slice(0, 20),
    candele_4h_recenti: marketSnapshot.candles["4h"]?.slice(0, 20),
    news_rilevanti: news,
    calendario_economico: calendar,
  };
}

// ---------------------------------------------------------------------------
// PAYLOAD COMPATTO
//
// Il payload storico spedisce 100 candele grezze (20 per ciascuno di cinque
// timeframe) a ogni chiamata. Questo lo sostituisce con: la memoria strutturata
// del mercato, gli eventi ancora attivi, la sintesi strutturale di D1/H4, e una
// finestra grezza di sole 5 candele CHIUSE su M30, M15 e M5 -- abbastanza per
// vedere wick, sequenza e accelerazione recente.
//
// Tutti i campi citati per nome dal prompt di sistema restano presenti con lo
// stesso nome: le zone vengono ridotte alle piu' vicine al prezzo, non rimosse.
// ---------------------------------------------------------------------------

const ZONE_VICINE_PAYLOAD = 3;

function distanzaZona(prezzo: number, z: { top: number; bottom: number }): number {
  const alto = Math.max(Number(z.top), Number(z.bottom));
  const basso = Math.min(Number(z.top), Number(z.bottom));
  if (!Number.isFinite(alto) || !Number.isFinite(basso)) return Number.POSITIVE_INFINITY;
  if (prezzo >= basso && prezzo <= alto) return 0;
  return prezzo > alto ? prezzo - alto : basso - prezzo;
}

function vicine<T extends { top: number; bottom: number }>(zone: T[] | undefined, prezzo: number): T[] {
  if (!Array.isArray(zone)) return [];
  return [...zone].sort((a, b) => distanzaZona(prezzo, a) - distanzaZona(prezzo, b)).slice(0, ZONE_VICINE_PAYLOAD);
}

function candeleChiuse(candele: unknown[] | undefined, quante = 5) {
  if (!Array.isArray(candele)) return [];
  return candele.slice(1, 1 + quante);
}

export interface EventoPayload {
  id: string;
  tipo: string;
  timeframe: string;
  direzione: string;
  livello: number;
  candelaTs: string;
}

// Unica funzione che prepara cio' che viene spedito a OpenAI.
//
// Deduplicazione: le zone M30, M15 e M5 viaggiano SOLO nei campi ict_* (che il
// prompt di sistema nomina per nome, per supportare i setup sia M30-led sia
// M15-led); da memoria_mercato vengono tolte per tutti e tre i timeframe.
// Gli UUID degli eventi non vengono mai spediti: al loro posto alias locali
// E1, E2, E3. Gli UUID veri restano nel database.
export function buildAiPayload({
  marketSnapshot,
  news,
  calendar,
  memoriaMercato,
  eventiAttivi,
  scenario,
  tradeProposto,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
  memoriaMercato: Record<string, unknown>;
  eventiAttivi: EventoPayload[];
  scenario: unknown;
  tradeProposto?: unknown;
}) {
  const prezzo = marketSnapshot.xauusd;
  const ob = (v: unknown) => vicine(v as { top: number; bottom: number }[] | undefined, prezzo);

  const alias = new Map<string, string>();
  eventiAttivi.forEach((e, i) => alias.set(e.id, `E${i + 1}`));

  const eventiInChiaro = eventiAttivi.map(
    (e) =>
      `${alias.get(e.id)} = ${e.tipo} ${e.timeframe} ${e.direzione} ${Number(e.livello).toFixed(2)} (${e.candelaTs})`
  );

  const alleggerisci = (tf: Record<string, unknown> | undefined, tieniZone: boolean) => {
    if (!tf) return null;
    const { zoneVicine, eventiAttiviIds, ...resto } = tf as Record<string, unknown> & {
      zoneVicine?: unknown;
      eventiAttiviIds?: string[];
    };
    return {
      ...resto,
      eventi: (eventiAttiviIds ?? []).map((id) => alias.get(id) ?? "?"),
      ...(tieniZone ? { zoneVicine } : {}),
    };
  };

  const memoria = {
    prezzo: memoriaMercato.prezzo,
    aggiornatoIl: memoriaMercato.aggiornatoIl,
    m15: alleggerisci(memoriaMercato.m15 as Record<string, unknown>, false),
    m5: alleggerisci(memoriaMercato.m5 as Record<string, unknown>, false),
    liquidita24h: memoriaMercato.liquidita24h,
    eventiInvalidati: memoriaMercato.eventiInvalidati,
  };

  return {
    prezzo_attuale_xauusd: marketSnapshot.xauusd,
    variazione_pct_xauusd: marketSnapshot.xauusdChangePct,
    dxy: marketSnapshot.dxy,
    dxy_variazione_pct: marketSnapshot.dxyChangePct,
    us10y: marketSnapshot.us10y,
    us10y_variazione_pct: marketSnapshot.us10yChangePct,
    dxy_fonte: marketSnapshot.dxySource ?? "sconosciuta",
    dxy_eta_minuti: marketSnapshot.dxyAgeMinutes ?? null,
    us10y_fonte: marketSnapshot.us10ySource ?? "sconosciuta",
    us10y_eta_minuti: marketSnapshot.us10yAgeMinutes ?? null,
    atr_15m: marketSnapshot.atr15m ?? null,
    atr_1h: marketSnapshot.atr1h ?? null,
    atr_5m: marketSnapshot.atr5m ?? null,
    sessione_corrente: marketSnapshot.session?.sessione ?? "sconosciuta",
    minuti_da_apertura_londra: marketSnapshot.session?.minutiDaAperturaLondra ?? null,
    minuti_da_apertura_new_york: marketSnapshot.session?.minutiDaAperturaNewYork ?? null,
    finestra_apertura_volatile: marketSnapshot.session?.finestraAperturaVolatile ?? false,
    // Contesto calendario: stato attuale + festivita' di oggi e, solo se
    // rilevante, festivita' precedente. E' informazione aggiuntiva, non un filtro:
    // nessuna decisione viene presa qui. Se lo snapshot non lo porta (chiamate legacy) viene
    // ricalcolato al volo -- e' una funzione pura, senza rete ne' database.
    market_calendar_context: buildCompactCalendarContext(
      marketSnapshot.marketCalendar ?? getMarketCalendarContext()
    ),
    rigetto_5m: marketSnapshot.rigetto5m ?? null,
    rigetto_15m: marketSnapshot.rigetto15m ?? null,
    // Restano nel payload: posizione nel range, ampiezza e distanze dalle
    // rotture non sono duplicate altrove, e toglierle renderebbe l'AI piu'
    // cieca. La deduplicazione riguarda le ripetizioni, non l'informazione.
    livelli: marketSnapshot.levels ?? null,
    livelli_5m: marketSnapshot.levels5m ?? null,
    liquidita_24h: marketSnapshot.liquidita24h ?? null,
    ict_bias: marketSnapshot.ictBias ?? "laterale",
    sintesi_d1_h4: {
      bias_d1: marketSnapshot.biasD1 ?? "sconosciuto",
      bias_h4: marketSnapshot.biasH4 ?? "sconosciuto",
    },
    // Impianto ICT a tre livelli: H4/H1 narrativa, M15 setup, M5 timing.
    livelli_apertura: marketSnapshot.livelliApertura ?? null,
    ote_m15: marketSnapshot.oteM15 ?? null,
    kill_zone: marketSnapshot.killZone ?? null,
    judas_swing: marketSnapshot.judasSwing ?? null,
    ict_struttura_h4: marketSnapshot.ictStrutturaH4 ?? null,
    ict_order_block_h4: ob(marketSnapshot.ictOrderBlocksH4),
    ict_fvg_h4: ob(marketSnapshot.ictFvgH4),
    ict_livelli_uguali_h4: marketSnapshot.ictLivelliUgualiH4 ?? null,
    ict_struttura_h1: marketSnapshot.ictStrutturaH1 ?? null,
    ict_order_block_h1: ob(marketSnapshot.ictOrderBlocksH1),
    ict_fvg_h1: ob(marketSnapshot.ictFvgH1),
    ict_livelli_uguali_h1: marketSnapshot.ictLivelliUgualiH1 ?? null,
    ict_struttura_m15: marketSnapshot.ictStrutturaM15 ?? null,
    ict_order_block_m15: ob(marketSnapshot.ictOrderBlocksM15),
    ict_fvg_m15: ob(marketSnapshot.ictFvgM15),
    ict_livelli_uguali_m15: marketSnapshot.ictLivelliUgualiM15 ?? null,
    ict_struttura_5m: marketSnapshot.ictStrutturaM5 ?? null,
    ict_order_block_5m: ob(marketSnapshot.ictOrderBlocksM5),
    ict_fvg_5m: ob(marketSnapshot.ictFvgM5),
    memoria_mercato: memoria,
    eventi_attivi: eventiInChiaro,
    scenario,
    candele_chiuse_recenti: {
      m15: candeleChiuse(marketSnapshot.candles?.["15m"]),
      m5: candeleChiuse(marketSnapshot.candles?.["5m"]),
    },
    news_rilevanti: news,
    calendario_economico: calendar,
    // Il trade e' gia' costruito dal codice: direzione dalla struttura H1/H4,
    // livelli dal prezzo live. All'AI resta solo l'ultima parola.
    trade_proposto: tradeProposto ?? null,
  };
}

const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";

async function callOpenAI(systemPrompt: string, userPayload: unknown) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI errore ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Risposta OpenAI vuota");
  return content;
}

// Usata solo dalla diagnostica: manda a OpenAI un payload gia' costruito,
// con lo stesso SYSTEM_PROMPT del canale principale, per confrontare la
// decisione prodotta da payload vecchio e nuovo sugli stessi dati.
// ---------------------------------------------------------------------------
// SCENARIO DI REAZIONE A UNA NOTIZIA
//
// Cosa NON fa: non prova a indovinare il numero che uscira'. Il consenso e'
// gia' pubblico e gia' nel prezzo, e un modello linguistico che legge titoli
// non ha nessun vantaggio informativo su un dato non ancora calcolato. Se
// glielo si chiedesse comunque, risponderebbe in modo articolato e
// convincente con zero potere predittivo -- che e' il modo peggiore di
// sbagliare.
//
// Cosa fa: prepara la REAZIONE. Non "cosa esce" ma "se esce cosi', allora".
// E' ragionamento su relazioni note (dato forte -> dollaro forte -> oro giu'),
// non previsione. Serve a sapere in due secondi quale dei due ordini pendenti
// tenere quando il dato esce, invece di deciderlo nel panico.
// ---------------------------------------------------------------------------

const SCENARIO_PROMPT = `Sei un analista macro specializzato su XAUUSD (oro). Ricevi un evento economico IMMINENTE, il contesto di mercato attuale e le notizie recenti.

NON devi prevedere il valore che uscira'. Il consenso e' gia' noto e gia' prezzato: una previsione sul numero non ha valore. Se ti viene la tentazione di dire "probabilmente uscira' sopra le attese", fermati: non e' il tuo compito.

Devi produrre una MAPPA DI REAZIONE: tre rami condizionali con soglie numeriche esplicite, basati sulla relazione fra il dato, il dollaro e l'oro.

Considera:
- la direzione della relazione (dato USA forte -> dollaro forte -> oro debole, e viceversa)
- il posizionamento attuale: se l'oro e' gia' salito molto nelle ultime ore, una sorpresa nella stessa direzione ha meno spazio
- le notizie recenti: un contesto geopolitico o dichiarazioni politiche possono attenuare o amplificare la reazione al dato, e in certi casi dominarla del tutto
- il livello del dollar index e dei rendimenti a 10 anni forniti nel contesto

Rispondi SOLO con questo JSON, senza testo attorno:
{
  "evento": "nome dell'evento",
  "consenso": "valore atteso, come stringa",
  "ramo_sopra": { "soglia": "es. sopra 56.5", "direzione_oro": "ribassista|rialzista", "forza": "debole|media|forte", "cosa_fare": "una frase operativa" },
  "ramo_sotto": { "soglia": "es. sotto 54.0", "direzione_oro": "ribassista|rialzista", "forza": "debole|media|forte", "cosa_fare": "una frase operativa" },
  "ramo_in_linea": { "soglia": "es. fra 54.0 e 56.5", "direzione_oro": "nessuna", "forza": "debole", "cosa_fare": "una frase operativa" },
  "avvertenza": "il rischio principale di questa lettura, una frase",
  "confidenza_mappa": 0-100
}

"confidenza_mappa" NON e' la confidenza su cosa uscira': e' quanto ti fidi che la RELAZIONE dato->oro tenga in questo contesto specifico. Se ci sono notizie che possono dominare il dato (tensioni geopolitiche, dichiarazioni sulla politica monetaria, dazi), abbassala e dillo nell'avvertenza.`;

export async function generaScenarioNotizia({
  evento,
  marketSnapshot,
  news,
}: {
  evento: { title: string; country: string; impact: string; time: string };
  marketSnapshot: MarketSnapshot;
  news: unknown;
}) {
  const payload = {
    evento,
    contesto: {
      xauusd: marketSnapshot.xauusd,
      variazione_pct: marketSnapshot.xauusdChangePct ?? null,
      dxy: marketSnapshot.dxy ?? null,
      dxy_variazione_pct: marketSnapshot.dxyChangePct ?? null,
      us10y: marketSnapshot.us10y ?? null,
      us10y_variazione_pct: marketSnapshot.us10yChangePct ?? null,
      atr_15m: marketSnapshot.atr15m ?? null,
      bias_d1: marketSnapshot.biasD1 ?? null,
      bias_h4: marketSnapshot.biasH4 ?? null,
      liquidita_24h: marketSnapshot.liquidita24h ?? null,
    },
    notizie_recenti: news,
  };
  const content = await callOpenAI(SCENARIO_PROMPT, payload);
  return JSON.parse(content);
}

export async function generateSignalDaPayload(userPayload: unknown) {
  const content = await callOpenAI(SYSTEM_PROMPT, userPayload);
  return JSON.parse(content);
}

export async function generateSignal({
  marketSnapshot,
  news,
  calendar,
  memoriaMercato,
  eventiAttivi,
  scenario,
  tradeProposto,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
  memoriaMercato?: Record<string, unknown>;
  eventiAttivi?: EventoPayload[];
  scenario?: unknown;
  tradeProposto?: unknown;
}) {
  // Payload deduplicato: stessi fatti del vecchio, meta' dei caratteri.
  // Se il contesto non e' stato passato (chiamate legacy) si degrada a un
  // payload senza memoria, mai a un payload piu' povero di quello vecchio.
  const userPayload = buildAiPayload({
    marketSnapshot,
    news,
    calendar,
    memoriaMercato: memoriaMercato ?? {},
    eventiAttivi: eventiAttivi ?? [],
    scenario: scenario ?? null,
    tradeProposto: tradeProposto ?? null,
  });
  const content = await callOpenAI(SYSTEM_PROMPT, userPayload);
  const parsed = JSON.parse(content);
  return { ...parsed, marketSnapshot };
}

// Canale "trade veloce" (5m): stesso payload di mercato, ma prompt dedicato
// che ragiona su livelli_5m/atr_5m come fonte primaria. Segnale del tutto
// indipendente da generateSignal() -- salvato su una tabella separata.
export async function generateSignal5m({
  marketSnapshot,
  news,
  calendar,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
}) {
  const userPayload = buildUserPayload({ marketSnapshot, news, calendar });
  const content = await callOpenAI(SYSTEM_PROMPT_5M, userPayload);

  const parsed = JSON.parse(content);
  return { ...parsed, marketSnapshot };
}
