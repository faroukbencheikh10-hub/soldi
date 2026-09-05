import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings, type SettingsKey } from "@/lib/server/dailyPnl";

export const dynamic = "force-dynamic";

const ALLOWED: SettingsKey[] = [
  "lot_size",
  "daily_target_eur",
  "daily_max_loss_eur",
  "eurusd_rate",
];

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json(settings, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // Nessun auth extra: le altre POST di settings (ai-pause, chiamate)
  // accettano il body senza token. Stesso meccanismo.
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Partial<Record<SettingsKey, number>> = {};

    for (const key of ALLOWED) {
      if (!(key in body) || body[key] === undefined || body[key] === null || body[key] === "") {
        continue;
      }
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(
          { ok: false, error: `${key} deve essere un numero positivo` },
          { status: 400 }
        );
      }
      patch[key] = n;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna impostazione valida da aggiornare" },
        { status: 400 }
      );
    }

    const settings = await updateSettings(patch);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore sconosciuto" },
      { status: 500 }
    );
  }
}
