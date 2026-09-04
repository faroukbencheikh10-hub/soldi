import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Soldi Trend — XAUUSD senza ICT",
  description:
    "Copia di Soldi con strategia meccanica: trend H4, pullback Fibonacci, Judas Swing Londra. Nessun ICT, nessuna AI.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Soldi Trend",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${mono.variable} dark`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
