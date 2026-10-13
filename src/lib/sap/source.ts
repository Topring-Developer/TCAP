import type { SapDataSource } from "./types";

/** Lit le réglage côté navigateur. Défaut supabase si erreur. */
export async function fetchSapDataSource(): Promise<SapDataSource> {
  try {
    const res = await fetch("/api/sap/source");
    const json = await res.json();
    return json.source === "wrapper" ? "wrapper" : "supabase";
  } catch {
    return "supabase";
  }
}

export async function fetchSapKpiMonth(
  dataset: "picking" | "packaging" | "receiving" | "inventory",
  month: string
): Promise<unknown> {
  const res = await fetch(`/api/sap/kpi?dataset=${dataset}&month=${month}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Erreur SAP ${dataset}`);
  return json;
}

/** 12 derniers mois calendaires (YYYY-MM), du plus récent au plus ancien. */
export function last12MonthKeys(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return out;
}

/** Mois de fromMonth jusqu'au mois courant inclus. */
export function monthsFrom(fromMonth: string): string[] {
  const [y, m] = fromMonth.split("-").map(Number);
  const now = new Date();
  const out: string[] = [];
  let cy = y!;
  let cm = m!;
  while (
    cy < now.getFullYear() ||
    (cy === now.getFullYear() && cm <= now.getMonth() + 1)
  ) {
    out.push(`${cy}-${String(cm).padStart(2, "0")}`);
    cm += 1;
    if (cm > 12) {
      cm = 1;
      cy += 1;
    }
  }
  return out;
}
