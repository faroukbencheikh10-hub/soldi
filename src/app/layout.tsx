import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Investment Pal — Analisi XAUUSD e Segnali di Trading",
  description:
    "Piattaforma di analisi XAUUSD e generazione segnali di trading: tecnica + fondamentale, nessun dato inventato.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Investment Pal",
  },
  icons: {
    icon: "/icon-192.png",
    // iOS usa questa per la schermata Home e vuole 180x180 senza
    // trasparenza: gli angoli arrotondati li aggiunge lui. Puntava a
    // icon-192.png, che ora e' della dimensione giusta ma non di QUELLA
    // dimensione -- meglio un file dedicato.
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${mono.variable} dark`}>
      {/* Il manifest va aggiunto qui a mano, non tramite metadata.manifest:
          Next.js 14 in App Router inserisce da solo crossorigin="use-credentials"
          sul tag generato da metadata.manifest, il che fa fallire il fetch del
          manifest per errore CORS -- e senza un manifest valido Chrome/Android
          non considera mai il sito "installabile" (nessun prompt "Aggiungi a
          schermata Home", e il tasto manuale non funziona bene). Bug noto di
          Next.js 14, non risolvibile lasciando manifest nell'oggetto metadata. */}
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
