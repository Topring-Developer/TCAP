// ─── Production KPI utilities ───────────────────────────────────────────────

export type ExclusionReason =
  | "ok"
  | "standard_manquant"
  | "trop_lent"
  | "trop_rapide"
  | "quantite_zero"
  | "temps_zero";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  ok: "Inclus",
  standard_manquant: "Standard manquant",
  trop_lent: "> 10× standard",
  trop_rapide: "< 10% standard",
  quantite_zero: "Quantité nulle",
  temps_zero: "Temps nul",
};

/** Extrait la série = partie avant le premier point (ex: 63.150 → 63) */
export function extractSeries(itemCode: string): string {
  const trimmed = itemCode.trim();
  const dot = trimmed.indexOf(".");
  return dot === -1 ? trimmed : trimmed.slice(0, dot);
}

/** Convertit un temps Excel (fraction de jour), HH:MM:SS ou H:MM:SS AM/PM en minutes */
export function parseTimeToMinutes(value: unknown): number {
  if (value == null || value === "") return 0;

  // Excel stocke souvent une durée comme fraction de jour (ex: 0.0417 ≈ 1h)
  if (typeof value === "number") {
    if (!isFinite(value) || value < 0) return 0;
    return value * 24 * 60;
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.getHours() * 60 + value.getMinutes() + value.getSeconds() / 60;
  }

  const raw = String(value).trim();
  if (!raw) return 0;

  // Nombre décimal en texte (même fraction Excel)
  if (/^\d+([.,]\d+)?$/.test(raw) && !raw.includes(":")) {
    const n = parseFloat(raw.replace(",", "."));
    if (!isNaN(n) && n >= 0) return n * 24 * 60;
  }

  // HH:MM:SS avec éventuel AM/PM (Excel formaté)
  const isPM = /\bpm\b/i.test(raw);
  const isAM = /\bam\b/i.test(raw);
  const cleaned = raw.replace(/\s*(AM|PM|am|pm)\s*$/i, "").trim();
  const parts = cleaned.split(":").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return 0;

  let [h, m, s = 0] = parts;
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h * 60 + m + s / 60;
}

/** Formate minutes en affichage lisible */
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/** Formate un temps unitaire (souvent < 10 min) sans l’arrondir à la minute */
export function formatUnitMinutes(min: number): string {
  if (!isFinite(min) || min <= 0) return "—";
  const digits = min < 10 ? 1 : 0;
  return `${min.toLocaleString("fr-CA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} min`;
}

/** Formate % avec signe */
export function formatPct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Compare deux segments numériques en tolérant les zéros finaux perdus par Excel.
 * ex: "15" matche "150", "718" matche "718"
 */
function segmentsMatch(raw: string, std: string): boolean {
  if (raw.toLowerCase() === std.toLowerCase()) return true;

  const rawNum = raw.match(/^(\d+)(.*)$/);
  const stdNum = std.match(/^(\d+)(.*)$/);
  if (!rawNum || !stdNum) return raw.toLowerCase() === std.toLowerCase();

  const [, rDigits, rSuffix] = rawNum;
  const [, sDigits, sSuffix] = stdNum;

  if (rSuffix.toLowerCase() !== sSuffix.toLowerCase()) return false;

  if (rDigits === sDigits) return true;
  // Excel a tronqué les zéros finaux: 15 vs 150
  if (sDigits.startsWith(rDigits) && /^0+$/.test(sDigits.slice(rDigits.length))) return true;
  if (rDigits.startsWith(sDigits) && /^0+$/.test(rDigits.slice(sDigits.length))) return true;

  return false;
}

/** Vérifie si deux codes item sont équivalents (zéros finaux, casse) */
export function itemsEquivalent(raw: string, standard: string): boolean {
  const a = raw.trim();
  const b = standard.trim();
  if (a.toLowerCase() === b.toLowerCase()) return true;

  const aParts = a.split(".");
  const bParts = b.split(".");
  if (aParts.length !== bParts.length) return false;

  return aParts.every((part, i) => segmentsMatch(part, bParts[i]!));
}

/** Trouve le code standard correspondant dans la liste */
export function matchItemCode(raw: string, standards: string[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const exact = standards.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const fuzzy = standards.find((s) => itemsEquivalent(trimmed, s));
  return fuzzy ?? null;
}

const RATIO_SLOW = 10;
const RATIO_FAST = 0.1;

export type ExclusionResult = {
  includedInKpi: boolean;
  exclusionReason: ExclusionReason;
  ratio: number | null;
};

/** Évalue si une ligne doit être incluse dans le KPI */
export function evaluateExclusion(
  quantity: number,
  actualMinutes: number,
  standardMinutesPerUnit: number | null
): ExclusionResult {
  if (quantity <= 0) {
    return { includedInKpi: false, exclusionReason: "quantite_zero", ratio: null };
  }
  if (actualMinutes <= 0) {
    return { includedInKpi: false, exclusionReason: "temps_zero", ratio: null };
  }
  if (standardMinutesPerUnit == null || standardMinutesPerUnit <= 0) {
    return { includedInKpi: false, exclusionReason: "standard_manquant", ratio: null };
  }

  const actualPerUnit = actualMinutes / quantity;
  const ratio = actualPerUnit / standardMinutesPerUnit;

  if (ratio > RATIO_SLOW) {
    return { includedInKpi: false, exclusionReason: "trop_lent", ratio };
  }
  if (ratio < RATIO_FAST) {
    return { includedInKpi: false, exclusionReason: "trop_rapide", ratio };
  }

  return { includedInKpi: true, exclusionReason: "ok", ratio };
}

/** Parse une date Excel ou string → YYYY-MM pour period_month */
export function toPeriodMonth(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  if (typeof value === "number") {
    // Serial Excel (days since 1899-12-30)
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
  }

  const str = String(value).trim();
  const iso = str.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  const fr = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (fr) return `${fr[1]}-${fr[2]}`;

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  return null;
}

/** Parse date Excel → ISO datetime string ou null */
export function toDatetime(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  const str = String(value).trim();
  const d = new Date(str.replace(" ", "T"));
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

/** Lit une cellule item comme texte (préserve zéros si format texte) */
export function cellToItemCode(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") {
    // Excel a converti en nombre — on garde la représentation
    return String(value);
  }
  return String(value).trim();
}

/** Normalise un en-tête de colonne pour matching flexible */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Trouve l'index d'une colonne par mots-clés */
export function findColumnIndex(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) => {
    const norm = normalizeHeader(h);
    return keywords.some((k) => norm.includes(k));
  });
}

export type ProductionKpiSummary = {
  actualMinutes: number;
  targetMinutes: number;
  varianceMinutes: number;
  variancePct: number;
  totalLines: number;
  includedLines: number;
  excludedLines: number;
  exclusionsByReason: Record<string, number>;
};

export function computeProductionSummary(
  rows: Array<{
    actual_minutes: number;
    target_minutes: number | null;
    included_in_kpi: boolean;
    exclusion_reason: string | null;
  }>
): ProductionKpiSummary {
  const included = rows.filter((r) => r.included_in_kpi);
  const actualMinutes = included.reduce((s, r) => s + r.actual_minutes, 0);
  const targetMinutes = included.reduce((s, r) => s + (r.target_minutes ?? 0), 0);
  const varianceMinutes = targetMinutes - actualMinutes;
  const variancePct = targetMinutes > 0 ? (varianceMinutes / targetMinutes) * 100 : 0;

  const exclusionsByReason: Record<string, number> = {};
  for (const r of rows.filter((r) => !r.included_in_kpi)) {
    const reason = r.exclusion_reason ?? "unknown";
    exclusionsByReason[reason] = (exclusionsByReason[reason] ?? 0) + 1;
  }

  return {
    actualMinutes,
    targetMinutes,
    varianceMinutes,
    variancePct,
    totalLines: rows.length,
    includedLines: included.length,
    excludedLines: rows.length - included.length,
    exclusionsByReason,
  };
}

export type SeriesSummary = {
  series: string;
  actualMinutes: number;
  targetMinutes: number;
  varianceMinutes: number;
  variancePct: number;
  lineCount: number;
};

export function computeSeriesSummaries(
  rows: Array<{
    series: string;
    actual_minutes: number;
    target_minutes: number | null;
    included_in_kpi: boolean;
    item_code: string;
    item_code_matched: string | null;
    ratio: number | null;
    quantity: number;
    exclusion_reason: string | null;
  }>
): SeriesSummary[] {
  const included = rows.filter((r) => r.included_in_kpi);
  const bySeries = new Map<string, SeriesSummary>();

  for (const r of included) {
    const existing = bySeries.get(r.series) ?? {
      series: r.series,
      actualMinutes: 0,
      targetMinutes: 0,
      varianceMinutes: 0,
      variancePct: 0,
      lineCount: 0,
    };
    existing.actualMinutes += r.actual_minutes;
    existing.targetMinutes += r.target_minutes ?? 0;
    existing.lineCount += 1;
    bySeries.set(r.series, existing);
  }

  return [...bySeries.values()]
    .map((s) => ({
      ...s,
      varianceMinutes: s.targetMinutes - s.actualMinutes,
      variancePct: s.targetMinutes > 0 ? ((s.targetMinutes - s.actualMinutes) / s.targetMinutes) * 100 : 0,
    }))
    .sort((a, b) => a.variancePct - b.variancePct);
}

export type ItemSummary = {
  itemCode: string;
  productionCount: number;
  quantity: number;
  actualMinutes: number;
  targetMinutes: number;
  varianceMinutes: number;
  variancePct: number;
  ratio: number | null;
};

export type FocusItem = ItemSummary & { series: string };

type ItemRow = {
  item_code: string;
  item_code_matched: string | null;
  series: string;
  quantity: number;
  actual_minutes: number;
  target_minutes: number | null;
  ratio: number | null;
  included_in_kpi: boolean;
};

function aggregateItemsByCode(rows: ItemRow[]): FocusItem[] {
  const included = rows.filter((r) => r.included_in_kpi);
  const byItem = new Map<string, FocusItem>();

  for (const r of included) {
    const code = r.item_code_matched ?? r.item_code;
    const key = `${r.series}::${code}`;
    const existing = byItem.get(key) ?? {
      itemCode: code,
      series: r.series,
      productionCount: 0,
      quantity: 0,
      actualMinutes: 0,
      targetMinutes: 0,
      varianceMinutes: 0,
      variancePct: 0,
      ratio: null,
    };
    existing.productionCount += 1;
    existing.quantity += Number(r.quantity);
    existing.actualMinutes += r.actual_minutes;
    existing.targetMinutes += r.target_minutes ?? 0;
    byItem.set(key, existing);
  }

  return [...byItem.values()].map((s) => ({
    ...s,
    varianceMinutes: s.targetMinutes - s.actualMinutes,
    variancePct: s.targetMinutes > 0 ? ((s.targetMinutes - s.actualMinutes) / s.targetMinutes) * 100 : 0,
    ratio: s.targetMinutes > 0 ? s.actualMinutes / s.targetMinutes : null,
  }));
}

export function computeFocusItems(rows: ItemRow[], limit = 20): FocusItem[] {
  return aggregateItemsByCode(rows)
    .filter((s) => s.varianceMinutes < 0)
    .sort((a, b) => a.varianceMinutes - b.varianceMinutes)
    .slice(0, limit);
}

export function searchProductionItems(rows: ItemRow[], query: string, limit = 50): FocusItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matchedRows = rows.filter((r) => {
    const code = r.item_code.toLowerCase();
    const matched = r.item_code_matched?.toLowerCase() ?? "";
    return code.includes(q) || matched.includes(q);
  });

  return aggregateItemsByCode(matchedRows)
    .sort((a, b) => a.varianceMinutes - b.varianceMinutes)
    .slice(0, limit);
}

export function computeItemSummaries(
  rows: Array<{
    item_code: string;
    item_code_matched: string | null;
    quantity: number;
    actual_minutes: number;
    target_minutes: number | null;
    ratio: number | null;
    included_in_kpi: boolean;
  }>,
  series: string
): ItemSummary[] {
  const included = rows.filter((r) => r.included_in_kpi);
  const byItem = new Map<string, ItemSummary>();

  for (const r of included) {
    const code = r.item_code_matched ?? r.item_code;
    const existing = byItem.get(code) ?? {
      itemCode: code,
      productionCount: 0,
      quantity: 0,
      actualMinutes: 0,
      targetMinutes: 0,
      varianceMinutes: 0,
      variancePct: 0,
      ratio: null,
    };
    existing.productionCount += 1;
    existing.quantity += Number(r.quantity);
    existing.actualMinutes += r.actual_minutes;
    existing.targetMinutes += r.target_minutes ?? 0;
    byItem.set(code, existing);
  }

  return [...byItem.values()]
    .map((s) => ({
      ...s,
      varianceMinutes: s.targetMinutes - s.actualMinutes,
      variancePct: s.targetMinutes > 0 ? ((s.targetMinutes - s.actualMinutes) / s.targetMinutes) * 100 : 0,
      ratio: s.targetMinutes > 0 ? s.actualMinutes / s.targetMinutes : null,
    }))
    .sort((a, b) => {
      const aBad = a.varianceMinutes < 0;
      const bBad = b.varianceMinutes < 0;
      if (aBad && bBad) return b.actualMinutes - a.actualMinutes;
      if (aBad !== bBad) return aBad ? -1 : 1;
      return b.varianceMinutes - a.varianceMinutes;
    });
}

// ─── Attribution personne (BOM solo) vs équipe ──────────────────────────────
// L'agrégat du mois (production_actuals) n'utilise pas ces fonctions.

export type AttributionLine = {
  id_sap: string;
  itemcode: string;
  bom: string | null;
  quantity: number;
  duration_minutes: number | null;
};

/** BOM vide ou blanc : on ne peut pas savoir s'il est partagé. */
export function normalizeBom(bom: string | null | undefined): string | null {
  const trimmed = (bom ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Un BOM est solo si un seul id_sap apparaît sur toutes les lignes fournies. */
export function soloBomIds(lines: { bom: string | null; id_sap: string }[]): Set<string> {
  const people = new Map<string, Set<string>>();
  for (const line of lines) {
    const bom = normalizeBom(line.bom);
    if (!bom || !line.id_sap) continue;
    let ids = people.get(bom);
    if (!ids) {
      ids = new Set();
      people.set(bom, ids);
    }
    ids.add(line.id_sap);
  }
  const solo = new Set<string>();
  for (const [bom, ids] of people) {
    if (ids.size === 1) solo.add(bom);
  }
  return solo;
}

export type ItemEmployeeRank = {
  idSap: string;
  minutes: number;
  quantity: number;
  targetMinutes: number;
  /** Réel − cible. Positif = temps en trop. */
  lostMinutes: number;
  /** (cible − réel) / cible, même signe que le KPI du mois. */
  variancePct: number | null;
  minutesPerUnit: number | null;
  /** Min/unité de trop par rapport à la moyenne des autres employés solo. Positif = plus lent. */
  vsPeersMinutes: number | null;
};

/** Classement d'un item : BOM solo seulement, sans les exclusions 10× du KPI mensuel. */
export function rankSoloEmployeesOnItem(
  lines: AttributionLine[],
  solo: Set<string>,
  standardPerUnit: number | null
): ItemEmployeeRank[] {
  const byEmp = new Map<string, { minutes: number; quantity: number }>();

  for (const line of lines) {
    const bom = normalizeBom(line.bom);
    if (!bom || !solo.has(bom) || !line.id_sap) continue;
    const acc = byEmp.get(line.id_sap) ?? { minutes: 0, quantity: 0 };
    acc.minutes += Number(line.duration_minutes) || 0;
    acc.quantity += Number(line.quantity) || 0;
    byEmp.set(line.id_sap, acc);
  }

  const ranked: ItemEmployeeRank[] = [];
  for (const [idSap, acc] of byEmp) {
    if (acc.quantity <= 0 || standardPerUnit == null || standardPerUnit <= 0) continue;
    const targetMinutes = acc.quantity * standardPerUnit;
    const minutesPerUnit = acc.minutes / acc.quantity;
    ranked.push({
      idSap,
      minutes: acc.minutes,
      quantity: acc.quantity,
      targetMinutes,
      lostMinutes: acc.minutes - targetMinutes,
      variancePct: targetMinutes > 0 ? ((targetMinutes - acc.minutes) / targetMinutes) * 100 : null,
      minutesPerUnit,
      vsPeersMinutes: null,
    });
  }

  for (const row of ranked) {
    const others = ranked.filter((r) => r.idSap !== row.idSap && r.minutesPerUnit != null);
    if (others.length === 0 || row.minutesPerUnit == null) continue;
    const avg = others.reduce((s, r) => s + (r.minutesPerUnit ?? 0), 0) / others.length;
    row.vsPeersMinutes = row.minutesPerUnit - avg;
  }

  return ranked.sort((a, b) => b.lostMinutes - a.lostMinutes);
}

export type PersonSlice = {
  bom: string;
  itemCode: string;
  idSap: string;
  quantity: number;
  minutes: number;
  included: boolean;
  reason: ExclusionReason;
  targetMinutes: number;
};

export function buildPersonSlices(
  lines: AttributionLine[],
  solo: Set<string>,
  standards: Map<string, number>
): PersonSlice[] {
  const groups = new Map<string, PersonSlice>();

  for (const line of lines) {
    const bom = normalizeBom(line.bom);
    if (!bom || !solo.has(bom) || !line.id_sap) continue;
    const key = `${bom}\0${line.itemcode}\0${line.id_sap}`;
    let slice = groups.get(key);
    if (!slice) {
      slice = {
        bom,
        itemCode: line.itemcode,
        idSap: line.id_sap,
        quantity: 0,
        minutes: 0,
        included: false,
        reason: "ok",
        targetMinutes: 0,
      };
      groups.set(key, slice);
    }
    slice.quantity += Number(line.quantity) || 0;
    slice.minutes += Number(line.duration_minutes) || 0;
  }

  for (const slice of groups.values()) {
    const std = standards.get(slice.itemCode) ?? null;
    const result = evaluateExclusion(slice.quantity, slice.minutes, std);
    slice.included = result.includedInKpi;
    slice.reason = result.exclusionReason;
    slice.targetMinutes = result.includedInKpi && std != null ? slice.quantity * std : 0;
  }

  return [...groups.values()];
}

export type PersonProductionRow = {
  idSap: string;
  attributableQty: number;
  /** Nombre de BOM solo distincts inclus dans le rendement */
  soloBomCount: number;
  actualMinutes: number;
  targetMinutes: number;
  varianceMinutes: number;
  /** Cible / réel × 100. 100 = dans le standard. */
  yieldPct: number | null;
  sharedMinutes: number;
  zeroCloseCount: number;
  zeroCloseMinutes: number;
};

export type PersonExclusion = {
  idSap: string;
  itemCode: string;
  bom: string;
  reason: ExclusionReason;
  minutes: number;
  quantity: number;
};

export function summarizePeople(
  lines: AttributionLine[],
  solo: Set<string>,
  standards: Map<string, number>
): { people: PersonProductionRow[]; exclusions: PersonExclusion[] } {
  const slices = buildPersonSlices(lines, solo, standards);
  const byEmp = new Map<string, PersonProductionRow>();

  const soloBomSets = new Map<string, Set<string>>();

  const ensure = (idSap: string): PersonProductionRow => {
    let row = byEmp.get(idSap);
    if (!row) {
      row = {
        idSap,
        attributableQty: 0,
        soloBomCount: 0,
        actualMinutes: 0,
        targetMinutes: 0,
        varianceMinutes: 0,
        yieldPct: null,
        sharedMinutes: 0,
        zeroCloseCount: 0,
        zeroCloseMinutes: 0,
      };
      byEmp.set(idSap, row);
    }
    return row;
  };

  for (const line of lines) {
    if (!line.id_sap) continue;
    const row = ensure(line.id_sap);
    const minutes = Number(line.duration_minutes) || 0;
    const qty = Number(line.quantity) || 0;
    const bom = normalizeBom(line.bom);
    if (qty <= 0 && minutes > 0) row.zeroCloseCount += 1;
    if (!bom || !solo.has(bom)) row.sharedMinutes += minutes;
  }

  const exclusions: PersonExclusion[] = [];
  for (const slice of slices) {
    if (!slice.included) {
      exclusions.push({
        idSap: slice.idSap,
        itemCode: slice.itemCode,
        bom: slice.bom,
        reason: slice.reason,
        minutes: slice.minutes,
        quantity: slice.quantity,
      });
      if (slice.reason === "quantite_zero") {
        ensure(slice.idSap).zeroCloseMinutes += slice.minutes;
      }
      continue;
    }
    const row = ensure(slice.idSap);
    row.attributableQty += slice.quantity;
    row.actualMinutes += slice.minutes;
    row.targetMinutes += slice.targetMinutes;
    // Compter les BOM solo distincts inclus
    if (!soloBomSets.has(slice.idSap)) soloBomSets.set(slice.idSap, new Set());
    soloBomSets.get(slice.idSap)!.add(slice.bom);
  }

  const people = [...byEmp.values()].map((row) => ({
    ...row,
    varianceMinutes: row.targetMinutes - row.actualMinutes,
    yieldPct: row.actualMinutes > 0 && row.targetMinutes > 0
      ? (row.targetMinutes / row.actualMinutes) * 100
      : null,
    soloBomCount: soloBomSets.get(row.idSap)?.size ?? 0,
  }));

  people.sort((a, b) => a.varianceMinutes - b.varianceMinutes);
  return { people, exclusions };
}

/**
 * Calcule le rendement moyen de l'équipe par itemcode à partir des slices inclus.
 * Utile pour contextualiser le rendement d'un employé (standard serré vs problème individuel).
 */
export function teamStatsByItem(
  slices: PersonSlice[]
): Map<string, { rendementPct: number }> {
  const items = new Map<string, { totalMinutes: number; totalTarget: number }>();
  for (const slice of slices) {
    if (!slice.included) continue;
    const acc = items.get(slice.itemCode) ?? { totalMinutes: 0, totalTarget: 0 };
    acc.totalMinutes += slice.minutes;
    acc.totalTarget += slice.targetMinutes;
    items.set(slice.itemCode, acc);
  }
  const result = new Map<string, { rendementPct: number }>();
  for (const [itemCode, acc] of items) {
    result.set(itemCode, {
      rendementPct: acc.totalMinutes > 0 ? (acc.totalTarget / acc.totalMinutes) * 100 : 0,
    });
  }
  return result;
}
