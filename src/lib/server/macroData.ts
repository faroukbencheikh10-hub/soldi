import { getMacroFromYahoo } from "@/lib/server/yahooData";
import { getMacroFromFred } from "@/lib/server/fredData";

export type MacroSource = "yahoo" | "fred" | "none";

export interface MacroField {
  value: number | null;
  changePct: number | null;
  source: MacroSource;
  ageMinutes: number | null;
}

export interface MacroContext {
  dxy: MacroField;
  us10y: MacroField;
}

const EMPTY: MacroField = {
  value: null,
  changePct: null,
  source: "none",
  ageMinutes: null,
};

function ageFrom(quotedAt: number | null): number | null {
  if (quotedAt === null) return null;
  const minutes = Math.round((Date.now() - quotedAt) / 60000);
  return minutes >= 0 ? minutes : 0;
}

function build(
  primary: { value: number; changePct: number; quotedAt: number | null } | null,
  backup: { value: number; changePct: number; quotedAt: number | null } | null
): MacroField {
  if (primary) {
    return {
      value: primary.value,
      changePct: primary.changePct,
      source: "yahoo",
      ageMinutes: ageFrom(primary.quotedAt),
    };
  }
  if (backup) {
    return {
      value: backup.value,
      changePct: backup.changePct,
      source: "fred",
      ageMinutes: ageFrom(backup.quotedAt),
    };
  }
  return EMPTY;
}

export async function getMacroContext(): Promise<MacroContext> {
  const yahoo = await getMacroFromYahoo();

  const needsBackup = yahoo.dxy === null || yahoo.us10y === null;
  const fred = needsBackup ? await getMacroFromFred() : { dxy: null, us10y: null };

  return {
    dxy: build(yahoo.dxy, fred.dxy),
    us10y: build(yahoo.us10y, fred.us10y),
  };
}
