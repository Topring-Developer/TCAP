// ─── Entrepôt : Picking + Emballage consolidés ──────────────────────────────
// Volume = SAP toujours. Rythme picking = jours TWMS Picking propres seulement.

import { MIN_BLOCK_MINUTES, type PickingDailyRow, type PickingWaveRow, type S8PickingLog, computeWaveAverages, computeWaveAveragesFromMonths } from "./picking";
import type { PackagingDailyRow } from "./packaging";

export type SapVolumeRow = {
  employee_id: string | null;
  external_user_code: string | null;
  external_user_name: string;
  doc_date: string;
  line_count: number;
};

export type S8Log = S8PickingLog;

const GENERIC_NAME_RE = /^(expédition|expedition|étudiant\d*|etudiant\d*|inconnu)$/i;
const GENERIC_CODE_RE = /^(0+|0001|0002|0003)$/;

export function isGenericAccount(name: string, code?: string | null): boolean {
  if (code && GENERIC_CODE_RE.test(code.trim())) return true;
  return GENERIC_NAME_RE.test(name.trim());
}

function personKey(employeeId: string | null, name: string): string {
  return employeeId ?? `unmapped:${name}`;
}

function dayKey(person: string, date: string): string {
  return `${person}::${date}`;
}

type DayAgg = {
  pickLines: number;
  packLines: number;
  pickMinutesAll: number;
  pickMinutesValid: number;
  expMinutes: number;
  expMinutesValid: number;
};

function emptyDay(): DayAgg {
  return { pickLines: 0, packLines: 0, pickMinutesAll: 0, pickMinutesValid: 0, expMinutes: 0, expMinutesValid: 0 };
}

function addSap(
  days: Map<string, DayAgg>,
  rows: SapVolumeRow[],
  field: "pickLines" | "packLines"
) {
  for (const r of rows) {
    if (r.line_count <= 0) continue;
    const pk = personKey(r.employee_id, r.external_user_name);
    const k = dayKey(pk, r.doc_date);
    const d = days.get(k) ?? emptyDay();
    d[field] += r.line_count;
    days.set(k, d);
  }
}

function addS8(
  days: Map<string, DayAgg>,
  logs: S8Log[],
  field: "pick" | "exp"
) {
  for (const l of logs) {
    if (!l.employee_id || l.duration_minutes <= 0) continue;
    const k = dayKey(l.employee_id, l.log_date);
    const d = days.get(k) ?? emptyDay();
    if (field === "pick") {
      d.pickMinutesAll += l.duration_minutes;
      if (l.duration_minutes >= MIN_BLOCK_MINUTES) d.pickMinutesValid += l.duration_minutes;
    } else {
      d.expMinutes += l.duration_minutes;
      if (l.duration_minutes >= MIN_BLOCK_MINUTES) d.expMinutesValid += l.duration_minutes;
    }
    days.set(k, d);
  }
}

/** Plafond plancher / jour : au-delà = log impossible (oubli de fermer, chevauchement). */
export const MAX_FLOOR_HOURS_PER_DAY = 10;

/** Jour propre pour le rythme picking : lignes SAP picking + blocs TWMS Picking ≥ 30 min */
export function isCleanPickDay(d: DayAgg): boolean {
  return d.pickLines > 0 && d.pickMinutesValid > 0;
}

/** Picking SAP le même jour qu'un log Expédition, sans log Picking */
export function isMisloggedPickDay(d: DayAgg): boolean {
  return d.pickLines > 0 && d.pickMinutesAll === 0 && d.expMinutes > 0;
}

/** Emballage SAP avec log Picking, sans aucune ligne picking */
export function isPackUnderPickDay(d: DayAgg): boolean {
  return d.packLines > 0 && d.pickLines === 0 && d.pickMinutesAll > 0;
}

/** Heures plancher (picking + expédition) ≥ plafond */
export function isImpossibleFloorDay(d: DayAgg): boolean {
  return (d.pickMinutesAll + d.expMinutes) / 60 >= MAX_FLOOR_HOURS_PER_DAY;
}

/** Compte pour le l/h pick : jour propre et heures crédibles */
export function isRateEligibleDay(d: DayAgg): boolean {
  return isCleanPickDay(d) && !isImpossibleFloorDay(d);
}

/** Jour propre pour le rythme emballage : lignes SAP emb. + blocs TWMS Expédition ≥ 30 min */
export function isCleanPackDay(d: DayAgg): boolean {
  return d.packLines > 0 && d.expMinutesValid > 0;
}

/** Compte pour le l/h emb. : jour propre emballage, hors journées ≥ 10 h plancher */
export function isPackRateEligibleDay(d: DayAgg): boolean {
  return isCleanPackDay(d) && !isImpossibleFloorDay(d);
}

/** Lignes SAP exclues du % succès (problèmes de log seulement). */
export function excludedLogLinesForDay(d: DayAgg): number {
  let n = 0;
  if (isMisloggedPickDay(d)) n += d.pickLines;
  else if (d.pickLines > 0 && d.pickMinutesAll === 0 && d.expMinutes === 0) n += d.pickLines;
  if (isPackUnderPickDay(d)) n += d.packLines;
  if (isImpossibleFloorDay(d)) n += d.pickLines + d.packLines;
  return n;
}

export type WarehouseTeamSummary = {
  pickLines: number;
  packLines: number;
  totalLines: number;
  /** Nombre de vagues lancées (WaveKey distincts) — voir picking_wave_stats. */
  pickWaves: number;
  pickPicklists: number;
  /** Moyenne des lignes par vague lancée (arrondi entier) — toutes vagues. */
  linesPerWave: number | null;
  /** Moyenne des picklists par vague (2 décimales) — toutes vagues. */
  picklistsPerWave: number | null;
  /** Même moyennes hors vagues à 1 seule picklist. */
  linesPerWaveExclSinglePl: number | null;
  picklistsPerWaveExclSinglePl: number | null;
  pickHours: number;
  expHours: number;
  floorHours: number;
  /** L/h équipe picking : jours propres, hors journées ≥ 10 h plancher */
  teamPickLinesPerHour: number | null;
  peopleCount: number;
  misloggedPickLines: number;
  unmatchedPickLines: number;
  misloggedPct: number;
  workingDays: number;
  linesPerDay: number | null;
  hoursPerDay: number | null;
};

export function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Mois antérieurs disponibles, du plus récent au plus ancien (max `n`). */
export function priorAvailableMonths(ym: string, available: string[], n = 3): string[] {
  return [...available].filter((m) => m < ym).sort().reverse().slice(0, n);
}

export type RollingBenchmark = {
  monthCount: number;
  totalLines: number;
  pickLines: number;
  packLines: number;
  pickWaves: number;
  pickPicklists: number;
  linesPerWave: number | null;
  picklistsPerWave: number | null;
  linesPerWaveExclSinglePl: number | null;
  picklistsPerWaveExclSinglePl: number | null;
  floorHours: number;
  pickHours: number;
  teamPickLinesPerHour: number | null;
  misloggedPct: number;
  workingDays: number;
  linesPerDay: number | null;
  hoursPerDay: number | null;
  peopleCount: number;
};

export function rollingBenchmark(summaries: WarehouseTeamSummary[]): RollingBenchmark | null {
  if (summaries.length === 0) return null;
  const n = summaries.length;
  const totalLines = summaries.reduce((s, t) => s + t.totalLines, 0);
  const pickLines = summaries.reduce((s, t) => s + t.pickLines, 0);
  const packLines = summaries.reduce((s, t) => s + t.packLines, 0);
  const pickHours = summaries.reduce((s, t) => s + t.pickHours, 0);
  const floorHours = summaries.reduce((s, t) => s + t.floorHours, 0);
  const workingDays = summaries.reduce((s, t) => s + t.workingDays, 0);
  const mislogged = summaries.reduce((s, t) => s + t.misloggedPickLines, 0);
  const people = summaries.reduce((s, t) => s + t.peopleCount, 0);
  const linesPerWaveRolling = (() => {
    const vals = summaries
      .map((s) => s.linesPerWave)
      .filter((v): v is number => v != null);
    return vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : null;
  })();
  const picklistsPerWaveRolling = (() => {
    const vals = summaries
      .map((s) => s.picklistsPerWave)
      .filter((v): v is number => v != null);
    return vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null;
  })();
  const linesPerWaveExclRolling = (() => {
    const vals = summaries
      .map((s) => s.linesPerWaveExclSinglePl)
      .filter((v): v is number => v != null);
    return vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : null;
  })();
  const picklistsPerWaveExclRolling = (() => {
    const vals = summaries
      .map((s) => s.picklistsPerWaveExclSinglePl)
      .filter((v): v is number => v != null);
    return vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null;
  })();

  return {
    monthCount: n,
    totalLines: totalLines / n,
    pickLines: pickLines / n,
    packLines: packLines / n,
    pickWaves: summaries.reduce((s, t) => s + t.pickWaves, 0) / n,
    pickPicklists: summaries.reduce((s, t) => s + t.pickPicklists, 0) / n,
    linesPerWave: linesPerWaveRolling,
    picklistsPerWave: picklistsPerWaveRolling,
    linesPerWaveExclSinglePl: linesPerWaveExclRolling,
    picklistsPerWaveExclSinglePl: picklistsPerWaveExclRolling,
    floorHours: floorHours / n,
    pickHours: pickHours / n,
    teamPickLinesPerHour: (() => {
      const rates = summaries
        .map((t) => t.teamPickLinesPerHour)
        .filter((r): r is number => r != null);
      return rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : null;
    })(),
    misloggedPct: pickLines > 0 ? (mislogged / pickLines) * 100 : 0,
    workingDays: workingDays / n,
    linesPerDay: workingDays > 0 ? totalLines / workingDays : null,
    hoursPerDay: workingDays > 0 ? floorHours / workingDays : null,
    peopleCount: people / n,
  };
}

/** Heures plancher vs charge : 1 = les heures ont suivi le volume/jour. >1 = trop d'heures pour la charge. */
export function hoursLoadRatio(
  current: WarehouseTeamSummary,
  bench: { linesPerDay: number | null; hoursPerDay: number | null }
): number | null {
  if (!current.linesPerDay || !bench.linesPerDay || bench.linesPerDay === 0) return null;
  if (!current.hoursPerDay || !bench.hoursPerDay || bench.hoursPerDay === 0) return null;
  const volumeIndex = current.linesPerDay / bench.linesPerDay;
  if (volumeIndex === 0) return null;
  return current.hoursPerDay / bench.hoursPerDay / volumeIndex;
}

export type WarehouseVerdict = {
  text: string;
  good: boolean | null;
};

export function buildWarehouseVerdict(
  current: WarehouseTeamSummary,
  bench: { teamPickLinesPerHour: number | null; linesPerDay: number | null } | null,
  vsLabel: string
): WarehouseVerdict | null {
  if (!bench) return null;

  const ratePct =
    current.teamPickLinesPerHour != null && bench.teamPickLinesPerHour
      ? ((current.teamPickLinesPerHour - bench.teamPickLinesPerHour) / bench.teamPickLinesPerHour) * 100
      : null;
  const volPct =
    current.linesPerDay != null && bench.linesPerDay
      ? ((current.linesPerDay - bench.linesPerDay) / bench.linesPerDay) * 100
      : null;

  const slow = volPct != null && volPct < -8;
  const busy = volPct != null && volPct > 8;
  const rateUp = ratePct != null && ratePct > 3;
  const rateDown = ratePct != null && ratePct < -3;

  const volNote = slow
    ? "Mois plus calme que d’habitude (moins de lignes/jour)"
    : busy
      ? "Mois plus chargé que d’habitude"
      : "Volume dans la moyenne";

  if (current.teamPickLinesPerHour == null || bench.teamPickLinesPerHour == null) {
    return { text: `${volNote} — rythme picking non comparable (heures insuffisantes).`, good: null };
  }
  if (rateUp && slow) {
    return {
      text: `${volNote}, mais le rythme picking est au-dessus de ${vsLabel}. L’équipe n’a pas perdu en efficacité — c’est la demande qui a baissé.`,
      good: true,
    };
  }
  if (rateUp) {
    return {
      text: `Rythme picking au-dessus de ${vsLabel}${busy ? " malgré un volume plus élevé" : ""}. ${volNote}.`,
      good: true,
    };
  }
  if (rateDown && slow) {
    return {
      text: `${volNote}, et le rythme est sous ${vsLabel}. Les heures n’ont probablement pas baissé autant que les commandes.`,
      good: false,
    };
  }
  if (rateDown && busy) {
    return {
      text: `${volNote}, rythme sous ${vsLabel} — plus d’heures pour l’output, ou saturation.`,
      good: false,
    };
  }
  if (rateDown) {
    return { text: `Rythme picking sous ${vsLabel}. ${volNote}.`, good: false };
  }
  return { text: `Rythme picking stable vs ${vsLabel}. ${volNote}.`, good: null };
}

export function computeWarehouseTeam(
  pickRows: PickingDailyRow[],
  packRows: PackagingDailyRow[],
  pickLogs: S8Log[],
  expLogs: S8Log[],
  waveRows: PickingWaveRow[] = [],
  periodMonth?: string
): WarehouseTeamSummary {
  const days = new Map<string, DayAgg>();
  addSap(days, pickRows, "pickLines");
  addSap(days, packRows, "packLines");
  addS8(days, pickLogs, "pick");
  addS8(days, expLogs, "exp");

  let pickLines = 0;
  let packLines = 0;
  let misloggedPickLines = 0;
  let unmatchedPickLines = 0;
  let ratePickLines = 0;
  let ratePickMinutes = 0;
  const people = new Set<string>();

  for (const [k, d] of days) {
    const pk = k.split("::")[0]!;
    people.add(pk);
    pickLines += d.pickLines;
    packLines += d.packLines;
    if (d.pickLines > 0 && d.pickMinutesAll === 0) {
      if (d.expMinutes > 0) misloggedPickLines += d.pickLines;
      else unmatchedPickLines += d.pickLines;
    }
    if (isRateEligibleDay(d)) {
      ratePickLines += d.pickLines;
      ratePickMinutes += d.pickMinutesValid;
    }
  }

  const pickHours = pickLogs.reduce((s, l) => s + l.duration_minutes, 0) / 60;
  const expHours = expLogs.reduce((s, l) => s + l.duration_minutes, 0) / 60;
  const ratePickHours = ratePickMinutes / 60;
  const workDates = new Set<string>();
  for (const r of [...pickRows, ...packRows]) {
    if (r.line_count > 0) workDates.add(r.doc_date);
  }
  const workingDays = workDates.size;

  const waveStats = periodMonth
    ? computeWaveAverages(waveRows, periodMonth)
    : computeWaveAveragesFromMonths(waveRows);

  return {
    pickLines,
    packLines,
    totalLines: pickLines + packLines,
    pickWaves: waveStats.waveCount,
    pickPicklists: waveStats.totalPicklists,
    linesPerWave: waveStats.avgLinesPerWave,
    picklistsPerWave: waveStats.avgPicklistsPerWave,
    linesPerWaveExclSinglePl: waveStats.avgLinesPerWaveExclSinglePl,
    picklistsPerWaveExclSinglePl: waveStats.avgPicklistsPerWaveExclSinglePl,
    pickHours,
    expHours,
    floorHours: pickHours + expHours,
    /** L/h équipe : jours propres seulement, hors journées ≥ 10 h plancher */
    teamPickLinesPerHour: ratePickHours > 0 ? ratePickLines / ratePickHours : null,
    peopleCount: people.size,
    misloggedPickLines,
    unmatchedPickLines,
    misloggedPct: pickLines > 0 ? (misloggedPickLines / pickLines) * 100 : 0,
    workingDays,
    linesPerDay: workingDays > 0 ? (pickLines + packLines) / workingDays : null,
    hoursPerDay: workingDays > 0 ? (pickHours + expHours) / workingDays : null,
  };
}

export type WarehouseEmployeeSummary = {
  key: string;
  employeeId: string | null;
  displayName: string;
  isGeneric: boolean;
  pickLines: number;
  packLines: number;
  totalLines: number;
  pickSharePct: number | null;
  pickHours: number;
  expHours: number;
  /** Lignes picking des jours propres seulement */
  cleanPickLines: number;
  cleanPickHours: number;
  /** null si pas assez de jours propres */
  pickLinesPerHour: number | null;
  cleanPackLines: number;
  cleanPackHours: number;
  packLinesPerHour: number | null;
  evaluable: boolean;
  evaluablePack: boolean;
  cleanDays: number;
  cleanPackDays: number;
  pickDays: number;
  packDays: number;
  misloggedPickLines: number;
  unmatchedPickLines: number;
  excludedLogLines: number;
  successPct: number | null;
  packUnderPickDays: number;
  impossibleDays: number;
};

export function computeWarehouseEmployees(
  pickRows: PickingDailyRow[],
  packRows: PackagingDailyRow[],
  pickLogs: S8Log[],
  expLogs: S8Log[],
  employeeNames: Map<string, string>
): { list: WarehouseEmployeeSummary[]; avgCleanRate: number | null; avgCleanPackRate: number | null } {
  const days = new Map<string, DayAgg>();
  addSap(days, pickRows, "pickLines");
  addSap(days, packRows, "packLines");
  addS8(days, pickLogs, "pick");
  addS8(days, expLogs, "exp");

  type Acc = {
    employeeId: string | null;
    displayName: string;
    code: string | null;
    pickLines: number;
    packLines: number;
    pickMinutes: number;
    expMinutes: number;
    cleanPickLines: number;
    cleanPickMinutes: number;
    cleanDays: number;
    cleanPackLines: number;
    cleanPackMinutes: number;
    cleanPackDays: number;
    excludedLogLines: number;
    pickDays: Set<string>;
    packDays: Set<string>;
    misloggedPickLines: number;
    unmatchedPickLines: number;
    packUnderPickDays: number;
    impossibleDays: number;
  };

  const namesByKey = new Map<string, { name: string; code: string | null; employeeId: string | null }>();
  for (const r of [...pickRows, ...packRows]) {
    const key = personKey(r.employee_id, r.external_user_name);
    if (!namesByKey.has(key)) {
      namesByKey.set(key, {
        name: r.employee_id
          ? (employeeNames.get(r.employee_id) ?? r.external_user_name)
          : r.external_user_name,
        code: r.external_user_code,
        employeeId: r.employee_id,
      });
    }
  }
  for (const l of [...pickLogs, ...expLogs]) {
    if (!l.employee_id) continue;
    if (!namesByKey.has(l.employee_id)) {
      namesByKey.set(l.employee_id, {
        name: employeeNames.get(l.employee_id) ?? "Inconnu",
        code: null,
        employeeId: l.employee_id,
      });
    }
  }

  const byKey = new Map<string, Acc>();
  function accFor(key: string): Acc {
    let a = byKey.get(key);
    if (a) return a;
    const meta = namesByKey.get(key);
    a = {
      employeeId: meta?.employeeId ?? (key.startsWith("unmapped:") ? null : key),
      displayName: meta?.name ?? key,
      code: meta?.code ?? null,
      pickLines: 0,
      packLines: 0,
      pickMinutes: 0,
      expMinutes: 0,
      cleanPickLines: 0,
      cleanPickMinutes: 0,
      cleanDays: 0,
      cleanPackLines: 0,
      cleanPackMinutes: 0,
      cleanPackDays: 0,
      excludedLogLines: 0,
      pickDays: new Set(),
      packDays: new Set(),
      misloggedPickLines: 0,
      unmatchedPickLines: 0,
      packUnderPickDays: 0,
      impossibleDays: 0,
    };
    byKey.set(key, a);
    return a;
  }

  for (const [k, d] of days) {
    const pk = k.split("::")[0]!;
    const date = k.slice(pk.length + 2);
    const a = accFor(pk);
    a.pickLines += d.pickLines;
    a.packLines += d.packLines;
    a.pickMinutes += d.pickMinutesAll;
    a.expMinutes += d.expMinutes;
    if (d.pickLines > 0) a.pickDays.add(date);
    if (d.packLines > 0) a.packDays.add(date);
    if (isRateEligibleDay(d)) {
      a.cleanPickLines += d.pickLines;
      a.cleanPickMinutes += d.pickMinutesValid;
      a.cleanDays += 1;
    }
    if (isPackRateEligibleDay(d)) {
      a.cleanPackLines += d.packLines;
      a.cleanPackMinutes += d.expMinutesValid;
      a.cleanPackDays += 1;
    }
    a.excludedLogLines += excludedLogLinesForDay(d);
    if (isMisloggedPickDay(d)) a.misloggedPickLines += d.pickLines;
    else if (d.pickLines > 0 && d.pickMinutesAll === 0) a.unmatchedPickLines += d.pickLines;
    if (isPackUnderPickDay(d)) a.packUnderPickDays += 1;
    if (isImpossibleFloorDay(d)) a.impossibleDays += 1;
  }

  const list: WarehouseEmployeeSummary[] = [...byKey.entries()]
    .map(([key, a]) => {
      const totalLines = a.pickLines + a.packLines;
      const cleanHours = a.cleanPickMinutes / 60;
      const cleanPackHours = a.cleanPackMinutes / 60;
      const pickLinesPerHour = cleanHours > 0 ? a.cleanPickLines / cleanHours : null;
      const packLinesPerHour = cleanPackHours > 0 ? a.cleanPackLines / cleanPackHours : null;
      const generic = isGenericAccount(a.displayName, a.code) || !a.employeeId;
      const successPct =
        totalLines > 0
          ? ((totalLines - a.excludedLogLines) / totalLines) * 100
          : null;
      return {
        key,
        employeeId: a.employeeId,
        displayName: a.displayName,
        isGeneric: generic,
        pickLines: a.pickLines,
        packLines: a.packLines,
        totalLines,
        pickSharePct: totalLines > 0 ? (a.pickLines / totalLines) * 100 : null,
        pickHours: a.pickMinutes / 60,
        expHours: a.expMinutes / 60,
        cleanPickLines: a.cleanPickLines,
        cleanPickHours: cleanHours,
        pickLinesPerHour,
        cleanPackLines: a.cleanPackLines,
        cleanPackHours: cleanPackHours,
        packLinesPerHour,
        evaluable: pickLinesPerHour != null && !generic && a.cleanDays >= 1,
        evaluablePack: packLinesPerHour != null && !generic && a.cleanPackDays >= 1,
        cleanDays: a.cleanDays,
        cleanPackDays: a.cleanPackDays,
        pickDays: a.pickDays.size,
        packDays: a.packDays.size,
        misloggedPickLines: a.misloggedPickLines,
        unmatchedPickLines: a.unmatchedPickLines,
        excludedLogLines: a.excludedLogLines,
        successPct,
        packUnderPickDays: a.packUnderPickDays,
        impossibleDays: a.impossibleDays,
      };
    })
    .filter((e) => e.totalLines > 0 || e.pickHours > 0 || e.expHours > 0)
    .sort((a, b) => {
      if (a.isGeneric !== b.isGeneric) return a.isGeneric ? 1 : -1;
      return b.totalLines - a.totalLines;
    });

  const evaluable = list.filter((e) => e.evaluable && e.pickLinesPerHour != null);
  const avgCleanRate =
    evaluable.length > 0
      ? evaluable.reduce((s, e) => s + (e.pickLinesPerHour ?? 0), 0) / evaluable.length
      : null;
  const evaluablePack = list.filter((e) => e.evaluablePack && e.packLinesPerHour != null);
  const avgCleanPackRate =
    evaluablePack.length > 0
      ? evaluablePack.reduce((s, e) => s + (e.packLinesPerHour ?? 0), 0) / evaluablePack.length
      : null;

  return { list, avgCleanRate, avgCleanPackRate };
}

export type WarehouseDayRow = {
  date: string;
  pickLines: number;
  packLines: number;
  pickHours: number;
  expHours: number;
  clean: boolean;
  rateEligible: boolean;
  mislogged: boolean;
  unmatched: boolean;
  packUnderPick: boolean;
  impossibleHours: boolean;
};

export function computeWarehouseDays(
  pickRows: PickingDailyRow[],
  packRows: PackagingDailyRow[],
  pickLogs: S8Log[],
  expLogs: S8Log[],
  employeeKey: string
): WarehouseDayRow[] {
  const days = new Map<string, DayAgg>();
  const pickFiltered = pickRows.filter((r) => personKey(r.employee_id, r.external_user_name) === employeeKey);
  const packFiltered = packRows.filter((r) => personKey(r.employee_id, r.external_user_name) === employeeKey);
  const pickLogFiltered = pickLogs.filter((l) => l.employee_id && l.employee_id === employeeKey);
  const expLogFiltered = expLogs.filter((l) => l.employee_id && l.employee_id === employeeKey);
  addSap(days, pickFiltered, "pickLines");
  addSap(days, packFiltered, "packLines");
  addS8(days, pickLogFiltered, "pick");
  addS8(days, expLogFiltered, "exp");

  return [...days.entries()]
    .map(([k, d]) => {
      const date = k.slice(k.indexOf("::") + 2);
      return {
        date,
        pickLines: d.pickLines,
        packLines: d.packLines,
        pickHours: d.pickMinutesAll / 60,
        expHours: d.expMinutes / 60,
        clean: isCleanPickDay(d),
        rateEligible: isRateEligibleDay(d),
        mislogged: isMisloggedPickDay(d),
        unmatched: d.pickLines > 0 && d.pickMinutesAll === 0 && d.expMinutes === 0,
        packUnderPick: isPackUnderPickDay(d),
        impossibleHours: isImpossibleFloorDay(d),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type LogOffenders = {
  key: string;
  displayName: string;
  misloggedPickLines: number;
}[];

export function topMislogOffenders(list: WarehouseEmployeeSummary[], n = 8): LogOffenders {
  return list
    .filter((e) => e.misloggedPickLines > 0)
    .sort((a, b) => b.misloggedPickLines - a.misloggedPickLines)
    .slice(0, n)
    .map((e) => ({
      key: e.key,
      displayName: e.displayName,
      misloggedPickLines: e.misloggedPickLines,
    }));
}
