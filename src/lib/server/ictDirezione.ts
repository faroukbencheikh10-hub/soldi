// Memoria del bias HTF dell'ultimo snapshot.
// Serve perche' runAnalysis non passa ancora biasD1 a valutaIct.
export type H4ConfermaMem = "allineato" | "contrario" | "laterale" | "sconosciuto";

let ultimo = {
  biasD1: null as string | null,
  biasH4: null as string | null,
  h4Conferma: "sconosciuto" as H4ConfermaMem,
};

export function memorizzaBiasIct(biasD1: string, biasH4: string, h4Conferma?: H4ConfermaMem) {
  ultimo = {
    biasD1,
    biasH4,
    h4Conferma: h4Conferma ?? "sconosciuto",
  };
}

export function biasDailyMemorizzato(): string | null {
  return ultimo.biasD1;
}

export function biasH4Memorizzato(): string | null {
  return ultimo.biasH4;
}

export function h4ConfermaMemorizzata(): H4ConfermaMem {
  return ultimo.h4Conferma;
}
