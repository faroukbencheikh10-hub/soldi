import { NextRequest, NextResponse } from "next/server";
import {
  ensureSchema,
  getStrategiaAttiva,
  setStrategiaAttiva,
  type StrategiaAttiva,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";

const VALIDE: StrategiaAttiva[] = ["normale", "veloce"];

export async function GET() {
  try {
    await ensureSchema();
    return NextResponse.json({ ok: true, strategia: await getStrategiaAttiva() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const scelta = body?.strategia;

    // Solo i tre valori previsti: un valore inatteso finirebbe in
    // app_settings e getStrategiaAttiva lo tratterebbe come "normale",
    // lasciando la dashboard e il comportamento reale disallineati.
    if (!VALIDE.includes(scelta)) {
      return NextResponse.json(
        { ok: false, error: `Strategia non valida: ${String(scelta)}` },
        { status: 400 }
      );
    }

    await ensureSchema();
    await setStrategiaAttiva(scelta);
    return NextResponse.json({ ok: true, strategia: scelta });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
