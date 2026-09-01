import webpush from "web-push";
import { getAllPushSubscriptions, deletePushSubscription } from "@/lib/server/db";

let configured = false;

// Apple accetta come "sub" del JWT VAPID solo un mailto: o un https:// valido.
// Resta configurabile via env senza toccare il codice.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT?.trim() || "mailto:soldi-app@example.com";

function ensureVapidConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non impostate");
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  configured = true;
}

export interface EsitoPush {
  sent: number;
  removed: number;
  failed: number;
  /** Iscrizioni totali trovate: se e' 0 nessuno si e' mai iscritto da questo browser. */
  subscriptions: number;
  /**
   * Perche' gli invii sono falliti, raggruppati per codice. E' il campo che
   * mancava: prima ogni errore diverso da 404/410 veniva ignorato in silenzio
   * e "non arrivano le notifiche" era indistinguibile da "Apple rifiuta la
   * chiave". Ora /api/push/test lo restituisce nella risposta.
   *
   * Codici che vedrai davvero:
   *  403 -> chiave VAPID del server diversa da quella usata per iscriversi
   *         (NEXT_PUBLIC_VAPID_PUBLIC_KEY non corrisponde a VAPID_PUBLIC_KEY):
   *         va rigenerata la coppia e rifatta l'iscrizione dal telefono
   *  400 -> richiesta malformata, di solito il subject VAPID non valido
   *  404/410 -> iscrizione morta, viene cancellata da sola
   *  413 -> payload troppo grande
   */
  errori: { codice: string; quante: number; dettaglio: string }[];
}

export async function sendPushToAll(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<EsitoPush> {
  ensureVapidConfigured();

  const subs = await getAllPushSubscriptions();
  if (subs.length === 0) {
    console.error("[pushSend] nessuna iscrizione push registrata: niente da inviare");
    return { sent: 0, removed: 0, failed: 0, subscriptions: 0, errori: [] };
  }

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? "trading-signal",
  });

  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s.subscription, message))
  );

  let sent = 0;
  let removed = 0;
  let failed = 0;
  const perCodice = new Map<string, { quante: number; dettaglio: string }>();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      sent++;
      continue;
    }

    const errore = r.reason as { statusCode?: number; body?: string; message?: string };
    const statusCode = errore?.statusCode;
    const codice = statusCode !== undefined ? String(statusCode) : "rete";
    const dettaglio = (errore?.body || errore?.message || "nessun dettaglio").slice(0, 200);

    if (statusCode === 404 || statusCode === 410) {
      // Iscrizione morta: il browser l'ha revocata. Si cancella e basta,
      // non e' un errore di configurazione.
      await deletePushSubscription(subs[i].endpoint);
      removed++;
    } else {
      failed++;
    }

    const precedente = perCodice.get(codice);
    perCodice.set(codice, {
      quante: (precedente?.quante ?? 0) + 1,
      dettaglio: precedente?.dettaglio ?? dettaglio,
    });
  }

  const errori = [...perCodice.entries()].map(([codice, v]) => ({
    codice,
    quante: v.quante,
    dettaglio: v.dettaglio,
  }));

  if (failed > 0) {
    console.error(
      `[pushSend] ${failed} invii falliti su ${subs.length}:`,
      JSON.stringify(errori)
    );
  }
  if (sent === 0 && subs.length > 0) {
    console.error(
      `[pushSend] NESSUNA notifica consegnata su ${subs.length} iscrizioni. ` +
        `Se il codice e' 403 la chiave VAPID del server non corrisponde a quella usata dal telefono per iscriversi.`
    );
  }

  return { sent, removed, failed, subscriptions: subs.length, errori };
}
