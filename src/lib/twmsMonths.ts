/**
 * Mois avec logs TWMS (S8) importés — même règle que le registre d'import.
 * Les KPI qui croisent SAP + TWMS ne proposent que ces mois.
 */

const REGISTER_START = "2026-04";

type Client = ReturnType<typeof import("@/lib/supabase/client").createClient>;

function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Mois du plus récent au plus ancien, à partir de startYm. */
export function buildMonthRangeFrom(startYm: string = REGISTER_START): string[] {
  const now = new Date();
  const months: string[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  while (true) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym < startYm) break;
    months.push(ym);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return months;
}

/** 12 derniers mois calendaires (YYYY-MM), du plus récent au plus ancien. */
export function last12CalendarMonths(): string[] {
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

/**
 * Mois où s8_time_logs a au moins 1 ligne (count head, pas de plafond 1000).
 * Triés du plus récent au plus ancien.
 */
export async function fetchTwmsImportedMonths(
  supabase: Client,
  fromYm: string = REGISTER_START
): Promise<string[]> {
  const candidates = buildMonthRangeFrom(fromYm);
  const checks = await Promise.all(
    candidates.map(async (ym) => {
      const { start, end } = monthBounds(ym);
      const { count } = await supabase
        .from("s8_time_logs")
        .select("id", { count: "exact", head: true })
        .gte("log_date", start)
        .lte("log_date", end);
      return (count ?? 0) > 0 ? ym : null;
    })
  );
  return checks.filter((x): x is string => x !== null);
}

/** Parmi les mois TWMS, ceux qui tombent dans les 12 derniers mois calendaires. */
export function twmsMonthsInLast12(twmsMonths: string[]): string[] {
  const last12 = new Set(last12CalendarMonths());
  return twmsMonths.filter((m) => last12.has(m));
}
