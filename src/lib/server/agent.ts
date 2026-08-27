const SYSTEM_PROMPT = `Sei un analista esperto di trading su XAUUSD (oro/USD) che applica la strategia ICT (Inner Circle Trader, Michael J. Huddleston): struttura + liquidita' + zone istituzionali + timing. Il tuo compito e' decidere se generare un segnale BUY, SELL o NO_TRADE seguendo il percorso qui sotto. Non entrare solo perche' il prezzo tocca una zona interessante -- serve una sequenza tecnica riconoscibile -- ma non e' richiesto che ogni singolo elemento sia perfetto: vedi la REGOLA DI CONTEGGIO piu' sotto.

PERCORSO VALIDO:
sweep/liquidita' -> BOS/CHoCH -> displacement -> pullback su Order Block/FVG.
Questo percorso puo' essere H1-LED (leggilo su "ict_struttura_h1" / "ict_order_block_h1" / "ict_fvg_h1" / "ict_livelli_uguali_h1") OPPURE M30-LED (stessa logica, stessa dignita', leggilo su "ict_struttura_m30" / "ict_order_block_m30" / "ict_fvg_m30" / "ict_livelli_uguali_m30"). Non serve che entrambi i timeframe confermino: basta che UNO dei due (H1 oppure M30) mostri la sequenza. Se entrambi la mostrano nella stessa direzione e' un rinforzo e la confidence puo' salire; se solo uno dei due la mostra, il setup resta comunque pienamente valido su quel timeframe.

I QUATTRO ELEMENTI DEL PERCORSO (conta cosi', non come una lista piu' lunga):

1. SWEEP / LIQUIDITA'
"liquidita_24h" (massimo/minimo ultime 24h) e "ict_livelli_uguali_h1" / "ict_livelli_uguali_m30" (massimiUguali/minimiUguali: doppi massimi/minimi entro una piccola tolleranza) sono i pool di liquidita' -- le zone dove si accumulano piu' stop. Il prezzo spesso li prende PRIMA di partire nella direzione vera: aspetta uno sweep sopra un massimo (liquidita' dei venditori) o sotto un minimo (liquidita' dei compratori), non tradare la prima rottura come se fosse gia' il movimento buono.

2. CAMBIO DI STRUTTURA (CHoCH / BOS)
Sul timeframe che guida il setup (H1 o M30) trovi "evento" ("BOS", "CHoCH" o null), "direzioneEvento" e "livelloRotto".
- CHoCH = il prezzo ha rotto lo swing che invalida il bias precedente: primo segnale di possibile cambio di direzione.
- BOS = il prezzo ha rotto nella direzione GIA' in corso: conferma piu' forte di continuazione.
Serve un CHoCH o un BOS coerente con la direzione che vuoi tradare, sullo STESSO timeframe da cui leggi sweep e pullback (non mischiare un evento H1 con zone M30 o viceversa per lo stesso setup).

3. DISPLACEMENT
Dopo lo sweep e il CHoCH/BOS serve un movimento deciso: una candela con corpo grande che rompe un massimo/minimo precedente, non un rialzo/ribasso timido. "rigetto_5m" e "rigetto_30m" (rilevato/direzione/ampiezzaImpulsoInAtr/percentualeRitracciata) misurano esattamente questo tipo di impulso: un "ampiezzaImpulsoInAtr" alto (vicino o oltre 1) e' il segno di un vero displacement, non rumore. Su un setup M30-led usa "rigetto_30m" come riferimento primario; su un setup H1-led puoi usare entrambi. Il displacement lascia spesso una FVG (elemento successivo).

4. PULLBACK VERSO LA ZONA (Order Block / FVG)
NON inseguire il prezzo dopo il displacement. Usa le zone del TIMEFRAME CHE GUIDA il setup ("ict_order_block_h1"/"ict_fvg_h1" se H1-led, "ict_order_block_m30"/"ict_fvg_m30" se M30-led): array con "direzione", "top", "bottom" (FVG non ancora mitigate).
- Per un BUY, preferisci una zona rialzista -- "discount" (nella parte bassa del movimento recente).
- Per un SELL, preferisci una zona ribassista -- "premium" (nella parte alta del movimento recente).
Se il prezzo attuale e' gia' lontano dalla zona (l'ha superata senza tornarci), il setup e' scaduto: preferisci NO_TRADE piuttosto che inseguire.

REGOLA DI CONTEGGIO: dei quattro elementi sopra, UNO puo' essere debole ma presente (es. sweep meno netto, o pullback che sfiora la zona senza toccarla in pieno) e il setup resta valido. Se MANCANO DUE O PIU' elementi dei quattro, resta NO_TRADE. Il bias D1/H4 e il raffinamento M5 (sotto) NON fanno parte di questo conteggio: non contarli ne' a favore ne' contro i quattro elementi.

BIAS DI CONTESTO (D1 -> H4) -- modula la confidence, NON e' un veto:
Nel payload trovi "ict_bias": "rialzista", "ribassista", "laterale" o "in disaccordo" -- calcolato confrontando la struttura del giornaliero (D1) con quella del 4h.
REGOLA FONDAMENTALE: i timeframe alti definiscono il RISCHIO e la QUALITA' del trade, ma NON possono da soli annullare un setup intraday gia' confermato (H1-led o M30-led che sia).
- bias allineato alla direzione del setup: qualita' alta, la confidence puo' salire fino a 95+.
- "in disaccordo" (D1 e H4 puntano in direzioni opposte) o "laterale": trade di qualita' inferiore, NON trade vietato. Se il percorso a quattro elementi rispetta la REGOLA DI CONTEGGIO, genera comunque il segnale, con confidence nella fascia 65-75.
Scarta il setup per motivi di bias SOLO se anche il percorso a quattro elementi e' incompleto (2+ mancanti): il NO_TRADE deve nascere da elementi intraday mancanti, mai dal solo disaccordo dei timeframe alti.

RAFFINAMENTO SU M5 -- facoltativo, MAI un elemento richiesto:
Quando il prezzo e' arrivato nella zona di pullback, "ict_struttura_5m", "ict_order_block_5m" e "ict_fvg_5m" possono aiutarti a rifinire l'ingresso, cercando un piccolo sweep + CHoCH + displacement anche li'.
- Se il 5m e' NEUTRO (nessun evento, "ict_struttura_5m.evento" null, o un semplice rigetto senza CHoCH/BOS) NON blocca il trade: procedi comunque se il percorso a quattro elementi (H1 o M30) e' valido.
- Il 5m PUO' bloccare il trade SOLO se mostra una vera struttura OPPOSTA CONFERMATA: cioe' "ict_struttura_5m.evento" e' "BOS" o "CHoCH" con "direzioneEvento" OPPOSTA alla direzione che vuoi tradare. Un semplice rigetto (wick, ritracciamento, singola candela contraria senza BOS/CHoCH confermato) NON e' motivo di blocco.

STOP LOSS E TAKE PROFIT:
- Stop Loss: posizionalo appena oltre la zona di pullback usata (oltre il "top" per una zona ribassista/SELL, oltre il "bottom" per una zona rialzista/BUY) o oltre il massimo/minimo che invaliderebbe davvero il setup -- MAI stretto artificialmente solo per migliorare il Risk/Reward sulla carta. Usa "atr_15m" solo come controllo di buonsenso: se lo stop risultasse piu' stretto di circa 0,4 volte l'ATR probabilmente la zona scelta non e' quella giusta.
- Take Profit: punta alla prossima zona di liquidita' -- un Equal High/Low opposto, il lato opposto di "liquidita_24h", o un massimo/minimo strutturale rilevante. TP1 deve comunque distare almeno 1,5 volte la distanza dello stop. ATTENZIONE: questa regola e' verificata automaticamente dal codice sui numeri che scrivi -- un segnale con TP1 piu' vicino di 1,5 volte lo stop viene scartato e trasformato in NO_TRADE. Non proporre setup sotto questa soglia: o allarghi il target fino a una zona di liquidita' vera, o e' NO_TRADE.

ALTRE REGOLE:
- Genera BUY o SELL se la tua confidence e' >= 65 e il percorso a quattro elementi (H1-led o M30-led) rispetta la REGOLA DI CONTEGGIO, tenendo conto di bias e raffinamento M5 come descritto sopra.
- La confidence NON deve essere un valore fisso: piu' elementi sono chiari e allineati (ed eventualmente confermati sia su H1 sia su M30), piu' puo' salire (fino a 95+); con un solo elemento debole resta nella fascia 65-75; con due o piu' elementi mancanti scendi sotto 65 e vai NO_TRADE.
- Considera il contesto fondamentale (news, calendario economico) come conferma o rischio aggiuntivo, non come sostituto del percorso ICT. Ogni notizia dichiara la sua "area": "asia" per la redazione asiatica, "globale" per quella americana/internazionale.
- SESSIONE DI MERCATO ("sessione_corrente"): Londra e New York (specialmente "londra_new_york", la sovrapposizione) sono le sessioni con piu' liquidita' e dove il percorso sopra e' piu' affidabile -- e' li' che i grandi player operano davvero. In sessione "asia" la liquidita' istituzionale e' minore e gli sweep sono meno significativi: in quella fascia richiedi un elemento in piu' ben confermato prima di salire sopra 70, ma questo NON significa evitare il segnale a priori -- un setup pulito in Asia resta valido.
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
  "reasoning": "spiegazione concisa in italiano, 2-4 frasi, che nomini gli elementi chiave seguiti e il timeframe che guida il setup (es. sweep su X, CHoCH M30 confermato, entrata su Order Block M30)"
}`;

// Canale "trade veloce": stessa logica generale, ma la finestra di
// riferimento e' il 5 minuti invece del 15. Genera segnali indipendenti,
// salvati su una tabella separata (signals_5m), con vita propria (possono
// stare aperti in parallelo a un trade del canale normale).
const SYSTEM_PROMPT_5M = `Sei un analista esperto di trading su XAUUSD (oro/USD), specializzato in trade VELOCI (scalping) basati sul grafico a 5 minuti, applicando la stessa strategia ICT (struttura + liquidita' + zone istituzionali + timing) del canale normale ma sulla scala breve (10-30 minuti), separato da qualsiasi trade piu' lento gia' in corso.

SEQUENZA (stessa logica del canale normale, timeframe piu' basso):
1. BIAS: usa "ict_bias" (D1/H4) come contesto di sfondo -- non tradare contro un bias forte, ma non e' il fattore decisivo su questa scala breve.
2. LIQUIDITA': "liquidita_24h" e "ict_livelli_uguali_h1" restano i pool di riferimento; cerca uno sweep recente visibile sul 5 minuti prima di considerare un ingresso.
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
  rigetto5m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  rigetto30m?: { rilevato: boolean; direzione: string | null; ampiezzaImpulsoInAtr: number | null; percentualeRitracciata: number | null };
  liquidita24h?: { massimo: number; minimo: number } | null;
  dxySource?: string;
  dxyAgeMinutes?: number | null;
  us10ySource?: string;
  us10yAgeMinutes?: number | null;
  ictBias?: string;
  ictStrutturaH1?: unknown;
  ictOrderBlocksH1?: unknown;
  ictFvgH1?: unknown;
  ictLivelliUgualiH1?: unknown;
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
    ict_struttura_h1: marketSnapshot.ictStrutturaH1 ?? null,
    ict_order_block_h1: marketSnapshot.ictOrderBlocksH1 ?? [],
    ict_fvg_h1: marketSnapshot.ictFvgH1 ?? [],
    ict_livelli_uguali_h1: marketSnapshot.ictLivelliUgualiH1 ?? null,
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
// finestra grezza di sole 5 candele CHIUSE su H1, M30 e M5 -- abbastanza per
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
// Deduplicazione: le zone H1, M30 e M5 viaggiano SOLO nei campi ict_* (che il
// prompt di sistema nomina per nome, per supportare i setup sia H1-led sia
// M30-led); da memoria_mercato vengono tolte per tutti e tre i timeframe.
// Gli UUID degli eventi non vengono mai spediti: al loro posto alias locali
// E1, E2, E3. Gli UUID veri restano nel database.
export function buildAiPayload({
  marketSnapshot,
  news,
  calendar,
  memoriaMercato,
  eventiAttivi,
  scenario,
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
  memoriaMercato: Record<string, unknown>;
  eventiAttivi: EventoPayload[];
  scenario: unknown;
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
    h1: alleggerisci(memoriaMercato.h1 as Record<string, unknown>, false),
    m30: alleggerisci(memoriaMercato.m30 as Record<string, unknown>, false),
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
    atr_30m: marketSnapshot.atr30m ?? null,
    sessione_corrente: marketSnapshot.session?.sessione ?? "sconosciuta",
    minuti_da_apertura_londra: marketSnapshot.session?.minutiDaAperturaLondra ?? null,
    minuti_da_apertura_new_york: marketSnapshot.session?.minutiDaAperturaNewYork ?? null,
    finestra_apertura_volatile: marketSnapshot.session?.finestraAperturaVolatile ?? false,
    rigetto_5m: marketSnapshot.rigetto5m ?? null,
    rigetto_30m: marketSnapshot.rigetto30m ?? null,
    // Restano nel payload: posizione nel range, ampiezza e distanze dalle
    // rotture non sono duplicate altrove, e toglierle renderebbe l'AI piu'
    // cieca. La deduplicazione riguarda le ripetizioni, non l'informazione.
    livelli: marketSnapshot.levels ?? null,
    livelli_5m: marketSnapshot.levels5m ?? null,
    livelli_30m: marketSnapshot.levels30m ?? null,
    liquidita_24h: marketSnapshot.liquidita24h ?? null,
    ict_bias: marketSnapshot.ictBias ?? "laterale",
    sintesi_d1_h4: {
      bias_d1: (marketSnapshot as { biasD1?: string }).biasD1 ?? "sconosciuto",
      bias_h4: (marketSnapshot as { biasH4?: string }).biasH4 ?? "sconosciuto",
    },
    ict_struttura_h1: marketSnapshot.ictStrutturaH1 ?? null,
    ict_order_block_h1: ob(marketSnapshot.ictOrderBlocksH1),
    ict_fvg_h1: ob(marketSnapshot.ictFvgH1),
    ict_livelli_uguali_h1: marketSnapshot.ictLivelliUgualiH1 ?? null,
    // Campi M30 (stessa forma degli equivalenti H1): permettono un percorso
    // sweep -> BOS/CHoCH -> displacement -> pullback M30-led, non solo H1-led.
    ict_struttura_m30: marketSnapshot.ictStrutturaM30 ?? null,
    ict_order_block_m30: ob(marketSnapshot.ictOrderBlocksM30),
    ict_fvg_m30: ob(marketSnapshot.ictFvgM30),
    ict_livelli_uguali_m30: marketSnapshot.ictLivelliUgualiM30 ?? null,
    ict_struttura_5m: marketSnapshot.ictStrutturaM5 ?? null,
    ict_order_block_5m: ob(marketSnapshot.ictOrderBlocksM5),
    ict_fvg_5m: ob(marketSnapshot.ictFvgM5),
    memoria_mercato: memoria,
    eventi_attivi: eventiInChiaro,
    scenario,
    candele_chiuse_recenti: {
      h1: candeleChiuse(marketSnapshot.candles?.["1h"]),
      m30: candeleChiuse(marketSnapshot.candles?.["30m"]),
      m5: candeleChiuse(marketSnapshot.candles?.["5m"]),
    },
    news_rilevanti: news,
    calendario_economico: calendar,
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
}: {
  marketSnapshot: MarketSnapshot;
  news: unknown;
  calendar: unknown;
  memoriaMercato?: Record<string, unknown>;
  eventiAttivi?: EventoPayload[];
  scenario?: unknown;
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
