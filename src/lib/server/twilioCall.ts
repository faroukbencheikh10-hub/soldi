// ---------------------------------------------------------------------------
// CHIAMATA VOCALE (Twilio) -- spenta di default, un costo reale per chiamata
//
// A differenza delle notifiche push (gratuite, via web push), una chiamata
// vera passa da un servizio esterno a pagamento (Twilio) e costa qualche
// centesimo per chiamata piu' un canone mensile per il numero. Per questo
// NON parte mai da sola: serve sia l'interruttore "chiamate_attive" acceso
// dalla dashboard (vedi settings/chiamate) sia le quattro variabili
// d'ambiente Twilio configurate su Vercel. Se manca una delle due
// condizioni, la funzione non fa nulla -- silenziosamente, senza rompere il
// resto del ciclo: una chiamata mancata non deve mai far fallire l'analisi
// o la notifica push, che restano il canale principale.
// ---------------------------------------------------------------------------

import { chiamateAttive } from "@/lib/server/db";

// Il numero viene mascherato nei log: per diagnosticare un formato sbagliato
// bastano le ultime cifre, e i log di Vercel non sono il posto dove lasciare
// un numero di telefono per intero.
const mascherato = (n: string) => (n.length > 4 ? `***${n.slice(-4)}` : "***");

// Twilio richiede il formato E.164: +prefisso internazionale e cifre, senza
// spazi (es. +393331234567). Senza il "+" rifiuta con un HTTP 400 generico,
// difficile da diagnosticare a posteriori.
const FORMATO_E164 = /^\+[1-9]\d{6,14}$/;

function leggiCredenziali() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const numeroDa = process.env.TWILIO_FROM_NUMBER;
  const numeroA = process.env.TWILIO_TO_NUMBER;
  if (!accountSid || !authToken || !numeroDa || !numeroA) return null;
  return { accountSid, authToken, numeroDa, numeroA };
}

/** True se tutte e quattro le variabili Twilio sono presenti. Usato dalla
 * rotta impostazioni per dire alla dashboard se l'interruttore ha senso di
 * essere acceso (altrimenti mostra "Twilio non configurato").
 *
 * NON valida il formato dei numeri: quel controllo vive in chiamaTelefono e
 * scrive nei log. Questa funzione viene chiamata a ogni caricamento della
 * dashboard, e ripetere li' gli errori di formato riempirebbe i log senza
 * aggiungere nulla -- il posto giusto per accorgersene e' il momento in cui
 * una chiamata viene davvero tentata. */
export function twilioConfigurato(): boolean {
  return leggiCredenziali() !== null;
}

// Voce italiana di Amazon Polly, disponibile sulle chiamate Twilio senza
// configurazione aggiuntiva.
const VOCE_TWIML = "Polly.Bianca";

// TETTO GIORNALIERO DI CHIAMATE
//
// Una chiamata costa, e l'interruttore che le abilita sta su una rotta
// senza autenticazione come tutte le altre dell'app. Le altre impostazioni
// al massimo mettono in pausa l'AI -- cioe' fanno risparmiare; questa fa
// spendere, ed e' l'unica per cui vale la pena una rete di sicurezza.
//
// Il tetto protegge da tre cose insieme: qualcuno che accende l'interruttore
// senza titolo, un bug che generasse segnali a raffica, e un errore mio in
// una modifica futura. Dieci al giorno e' molto sopra il ritmo reale (pochi
// segnali attivati al giorno) ma abbastanza basso da rendere impossibile una
// bolletta a sorpresa.
const MAX_CHIAMATE_AL_GIORNO = 10;

// Contatore in memoria del processo. NON persistente di proposito: su
// Vercel ogni avvio a freddo lo azzera, quindi il tetto reale puo' essere
// piu' permissivo di dieci al giorno. E' un compromesso deliberato --
// tenerlo nel database significherebbe due query in piu' per ogni chiamata
// per un limite che serve solo come rete di sicurezza, non come quota
// contabile. Il grosso della protezione resta l'interruttore spento.
let chiamateOggi = { giorno: "", conteggio: 0 };

function tettoRaggiunto(): boolean {
  const oggi = new Date().toISOString().slice(0, 10);
  if (chiamateOggi.giorno !== oggi) {
    chiamateOggi = { giorno: oggi, conteggio: 0 };
  }
  return chiamateOggi.conteggio >= MAX_CHIAMATE_AL_GIORNO;
}

function escapeXml(testo: string): string {
  return testo
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Punto d'ingresso unico per le chiamate dal ciclo di analisi.
 *
 * Racchiude QUI dentro la lettura dell'interruttore dal database, invece di
 * lasciarla al chiamante. Cosi' il percorso della notifica push e quello
 * della chiamata restano separati: chi invia la notifica non deve
 * aspettare una query per decidere sulla chiamata, e un problema sul
 * database delle impostazioni non puo' rallentare o interrompere l'invio
 * del push, che e' il canale principale e gratuito.
 *
 * Come sendPushToAll: si invoca senza await e non lancia mai. Qualunque
 * cosa vada storta qui dentro -- interruttore illeggibile, credenziali
 * mancanti, Twilio irraggiungibile -- resta confinata e finisce solo nei log.
 */
export async function chiamaSeAttivo(testo: string): Promise<void> {
  try {
    if (!(await chiamateAttive())) return;
  } catch (err) {
    // L'interruttore non e' leggibile: nel dubbio NON si chiama. Una
    // chiamata costa, il silenzio no.
    console.error("[twilioCall] interruttore chiamate illeggibile, chiamata saltata:", err);
    return;
  }
  await chiamaTelefono(testo);
}

/**
 * Esegue la chiamata vera. Privata: l'unico ingresso dall'esterno e'
 * chiamaSeAttivo, cosi' il controllo dell'interruttore non puo' essere
 * aggirato per sbaglio da un altro punto del codice.
 *
 * Non lancia mai: logga e ritorna, come sendPushToAll.
 */
async function chiamaTelefono(testo: string): Promise<void> {
  const cred = leggiCredenziali();
  if (!cred) {
    console.log("[twilioCall] chiamata saltata: credenziali Twilio non configurate");
    return;
  }

  // Tetto giornaliero: rete di sicurezza contro spese impreviste.
  if (tettoRaggiunto()) {
    console.error(
      `[twilioCall] tetto di ${MAX_CHIAMATE_AL_GIORNO} chiamate giornaliere raggiunto: chiamata saltata`
    );
    return;
  }

  // Formato dei numeri validato qui, non in twilioConfigurato: e' il momento
  // in cui una chiamata viene davvero tentata, quindi l'unico in cui vale la
  // pena scrivere l'errore nei log.
  if (!FORMATO_E164.test(cred.numeroDa)) {
    console.error(
      `[twilioCall] TWILIO_FROM_NUMBER (${mascherato(cred.numeroDa)}) non e' in formato E.164, atteso tipo +393331234567: chiamata saltata`
    );
    return;
  }
  if (!FORMATO_E164.test(cred.numeroA)) {
    console.error(
      `[twilioCall] TWILIO_TO_NUMBER (${mascherato(cred.numeroA)}) non e' in formato E.164, atteso tipo +393331234567: chiamata saltata`
    );
    return;
  }

  // Il TwiML viaggia nel parametro "Twiml" del corpo form-encoded, che evita
  // di dover esporre un URL pubblico da cui Twilio scarichi le istruzioni.
  // Nomi in PascalCase (To, From, Twiml) come da API REST; limite del
  // parametro 4000 caratteri, il testo qui ne conta meno di 200.
  // Riferimento: https://www.twilio.com/docs/voice/api/call-resource
  const twiml = `<Response><Say voice="${VOCE_TWIML}" language="it-IT">${escapeXml(testo)}</Say></Response>`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cred.accountSid}/Calls.json`;
  const auth = Buffer.from(`${cred.accountSid}:${cred.authToken}`).toString("base64");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: cred.numeroA,
        From: cred.numeroDa,
        Twiml: twiml,
      }),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      console.error(`[twilioCall] chiamata fallita, HTTP ${res.status}: ${corpo.slice(0, 300)}`);
      return;
    }

    console.log("[twilioCall] chiamata avviata con successo");
    // Contata solo se e' partita davvero: un fallimento non consuma il tetto,
    // altrimenti un problema di rete finirebbe per bloccare le chiamate
    // successive che sarebbero andate a buon fine.
    chiamateOggi.conteggio += 1;
  } catch (err) {
    console.error("[twilioCall] errore di rete durante la chiamata:", err);
  }
}
