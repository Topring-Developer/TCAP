// ─── Picking KPI utilities ─────────────────────────────────────────────────

import { findColumnIndex } from "./production";
import {
  matchEmployee,
  periodKey,
  formatWeekLabel,
  type EmployeeMapping,
  type Granularity,
} from "./inventory";
import { parseSapDocDate, toPeriodMonth } from "./receiving";

export type PickingDailyRow = {
  id: string;
  employee_id: string | null;
  external_user_code: string | null;
  external_user_name: string;
  doc_date: string;
  period_month: string;
  line_count: number;
  wave_count: number;
  picklist_count: number;
};

/** 1 row = 1 WaveKey lancée dans le mois (agrégat import SAP). */
export type PickingWaveRow = {
  id?: string;
  wave_key: string;
  period_month: string;
  doc_date: string;
  line_count: number;
  picklist_count: number;
};

export function buildWaveExternalKey(periodMonth: string, waveKey: string): string {
  return `${periodMonth}::${waveKey}`;
}

export type WaveAverages = {
  waveCount: number;
  /** Vagues avec exactement 1 picklist (exclues de la 2e moyenne). */
  waveCountSinglePl: number;
  totalPicklists: number;
  /** Moyenne globale — toutes les vagues. */
  avgLinesPerWave: number | null;
  avgPicklistsPerWave: number | null;
  /** Moyenne hors vagues à 1 seule picklist. */
  avgLinesPerWaveExclSinglePl: number | null;
  avgPicklistsPerWaveExclSinglePl: number | null;
};

function meanRoundInt(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function meanRound2(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}

/** Densités par vague : globale + hors vagues à 1 picklist. */
export function computeWaveAverages(
  waves: PickingWaveRow[],
  periodMonth?: string
): WaveAverages {
  const filtered = periodMonth
    ? waves.filter((w) => w.period_month === periodMonth)
    : waves;
  const empty: WaveAverages = {
    waveCount: 0,
    waveCountSinglePl: 0,
    totalPicklists: 0,
    avgLinesPerWave: null,
    avgPicklistsPerWave: null,
    avgLinesPerWaveExclSinglePl: null,
    avgPicklistsPerWaveExclSinglePl: null,
  };
  if (filtered.length === 0) return empty;

  const multiPl = filtered.filter((w) => w.picklist_count >= 2);
  const totalPicklists = filtered.reduce((s, w) => s + w.picklist_count, 0);
  const totalLines = filtered.reduce((s, w) => s + w.line_count, 0);
  const multiLines = multiPl.reduce((s, w) => s + w.line_count, 0);
  const multiPicklists = multiPl.reduce((s, w) => s + w.picklist_count, 0);

  return {
    waveCount: filtered.length,
    waveCountSinglePl: filtered.length - multiPl.length,
    totalPicklists,
    avgLinesPerWave: Math.round(totalLines / filtered.length),
    avgPicklistsPerWave: Math.round((totalPicklists / filtered.length) * 100) / 100,
    avgLinesPerWaveExclSinglePl:
      multiPl.length > 0 ? Math.round(multiLines / multiPl.length) : null,
    avgPicklistsPerWaveExclSinglePl:
      multiPl.length > 0
        ? Math.round((multiPicklists / multiPl.length) * 100) / 100
        : null,
  };
}

/** Moyenne des métriques vague mois par mois (évite de pooler toutes les vagues sur plusieurs mois). */
export function computeWaveAveragesFromMonths(waves: PickingWaveRow[]): WaveAverages {
  const byMonth = new Map<string, PickingWaveRow[]>();
  for (const w of waves) {
    const list = byMonth.get(w.period_month) ?? [];
    list.push(w);
    byMonth.set(w.period_month, list);
  }
  const monthly = [...byMonth.values()]
    .map((list) => computeWaveAverages(list))
    .filter((m) => m.waveCount > 0);
  if (monthly.length === 0) {
    return {
      waveCount: 0,
      waveCountSinglePl: 0,
      totalPicklists: 0,
      avgLinesPerWave: null,
      avgPicklistsPerWave: null,
      avgLinesPerWaveExclSinglePl: null,
      avgPicklistsPerWaveExclSinglePl: null,
    };
  }
  const n = monthly.length;
  return {
    waveCount: Math.round(monthly.reduce((s, m) => s + m.waveCount, 0) / n),
    waveCountSinglePl: Math.round(monthly.reduce((s, m) => s + m.waveCountSinglePl, 0) / n),
    totalPicklists: Math.round(monthly.reduce((s, m) => s + m.totalPicklists, 0) / n),
    avgLinesPerWave: meanRoundInt(
      monthly.map((m) => m.avgLinesPerWave).filter((v): v is number => v != null)
    ),
    avgPicklistsPerWave: meanRound2(
      monthly.map((m) => m.avgPicklistsPerWave).filter((v): v is number => v != null)
    ),
    avgLinesPerWaveExclSinglePl: meanRoundInt(
      monthly.map((m) => m.avgLinesPerWaveExclSinglePl).filter((v): v is number => v != null)
    ),
    avgPicklistsPerWaveExclSinglePl: meanRound2(
      monthly
        .map((m) => m.avgPicklistsPerWaveExclSinglePl)
        .filter((v): v is number => v != null)
    ),
  };
}

export function formatAvgLinesPerWave(v: number | null): string {
  if (v == null) return "—";
  return String(v);
}

export function formatAvgPicklistsPerWave(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

/** Affiche globale · hors 1 picklist */
export function formatDualWaveAvg(
  global: number | null,
  exclSinglePl: number | null,
  picklists = false
): string {
  const g = picklists ? formatAvgPicklistsPerWave(global) : formatAvgLinesPerWave(global);
  const e = picklists ? formatAvgPicklistsPerWave(exclSinglePl) : formatAvgLinesPerWave(exclSinglePl);
  return `${g} · ${e}`;
}

export type S8PickingLog = {
  employee_id: string | null;
  log_date: string;
  duration_minutes: number;
};

export { matchEmployee, periodKey, formatWeekLabel, parseSapDocDate, toPeriodMonth };
export type { EmployeeMapping, Granularity };

/** Blocs S8 de moins de 30 min sont exclus du l/h individuel (setup / aide courte) */
export const MIN_BLOCK_MINUTES = 30;

export function buildPickingExternalKey(
  docDate: string,
  userCode: string | null,
  userName: string
): string {
  const id = (userCode?.trim() || userName.trim().toLowerCase()).replace(/\s+/g, "_");
  return `${docDate}_${id}`;
}

export const PICKING_COLUMN_ALIASES = {
  code: ["codeutilisateur", "code", "usercode", "userid", "u_id"],
  name: ["nomdelutilis", "nomutilisateur", "nom", "username", "uname", "employe"],
  date: ["createdate", "date", "docdate", "pickdate"],
  wave: ["wavekey", "wave", "vague"],
  picklist: ["picklistnumb", "picklist", "picklistnum", "picklistnumber"],
};

export function findPickingColumns(headers: string[]) {
  return {
    codeCol: findColumnIndex(headers, PICKING_COLUMN_ALIASES.code),
    nameCol: findColumnIndex(headers, PICKING_COLUMN_ALIASES.name),
    dateCol: findColumnIndex(headers, PICKING_COLUMN_ALIASES.date),
    waveCol: findColumnIndex(headers, PICKING_COLUMN_ALIASES.wave),
    picklistCol: findColumnIndex(headers, PICKING_COLUMN_ALIASES.picklist),
  };
}

export type TeamPickingSummary = {
  totalLines: number;
  totalHours: number;
  linesPerHour: number | null;
  activeEmployees: number;
  totalWaves: number;
  totalPicklists: number;
  linesPerWave: number | null;
  picklistsPerWave: number | null;
  linesPerWaveExclSinglePl: number | null;
  picklistsPerWaveExclSinglePl: number | null;
};

export function computeTeamPickingSummary(
  sapRows: PickingDailyRow[],
  s8Logs: S8PickingLog[],
  waveRows: PickingWaveRow[] = [],
  periodMonth?: string
): TeamPickingSummary {
  const totalLines = sapRows.reduce((s, r) => s + r.line_count, 0);
  const waveStats = periodMonth
    ? computeWaveAverages(waveRows, periodMonth)
    : computeWaveAveragesFromMonths(waveRows);
  const totalMinutes = s8Logs.reduce((s, r) => s + r.duration_minutes, 0);
  const totalHours = totalMinutes / 60;
  const personKeys = new Set<string>();
  for (const r of sapRows) {
    personKeys.add(r.employee_id ?? `unmapped:${r.external_user_name}`);
  }
  for (const l of s8Logs) {
    if (l.employee_id) personKeys.add(l.employee_id);
  }

  return {
    totalLines,
    totalHours,
    linesPerHour: totalHours > 0 ? totalLines / totalHours : null,
    activeEmployees: personKeys.size,
    totalWaves: waveStats.waveCount,
    totalPicklists: waveStats.totalPicklists,
    linesPerWave: waveStats.avgLinesPerWave,
    picklistsPerWave: waveStats.avgPicklistsPerWave,
    linesPerWaveExclSinglePl: waveStats.avgLinesPerWaveExclSinglePl,
    picklistsPerWaveExclSinglePl: waveStats.avgPicklistsPerWaveExclSinglePl,
  };
}

export type EmployeePickingSummary = {
  key: string;
  employeeId: string | null;
  displayName: string;
  totalLines: number;
  /** Toutes les heures S8 (incluant blocs < 30 min) — pour affichage */
  totalHours: number;
  /** Heures des blocs >= 30 min seulement — base du l/h individuel */
  validHours: number;
  /** null si validHours = 0 (données insuffisantes) */
  linesPerHour: number | null;
  totalWaves: number;
  totalPicklists: number;
  linesPerWave: number | null;
  picklistsPerWave: number | null;
  daysWithSap: number;
  daysWithS8: number;
  /** true si l'employé a des heures S8 mais aucun bloc >= 30 min */
  insufficientData: boolean;
};

export function computeEmployeePickingSummaries(
  sapRows: PickingDailyRow[],
  s8Logs: S8PickingLog[],
  employeeNames: Map<string, string>
): EmployeePickingSummary[] {
  const byKey = new Map<
    string,
    {
      employeeId: string | null;
      displayName: string;
      lines: number;
      waves: number;
      picklists: number;
      sapDates: Set<string>;
      s8Dates: Set<string>;
      minutesAll: number;
      minutesValid: number;
    }
  >();

  for (const r of sapRows) {
    const key = r.employee_id ?? `unmapped:${r.external_user_name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.lines += r.line_count;
      existing.waves += r.wave_count;
      existing.picklists += r.picklist_count;
      existing.sapDates.add(r.doc_date);
    } else {
      byKey.set(key, {
        employeeId: r.employee_id,
        displayName: r.employee_id
          ? (employeeNames.get(r.employee_id) ?? r.external_user_name)
          : r.external_user_name,
        lines: r.line_count,
        waves: r.wave_count,
        picklists: r.picklist_count,
        sapDates: new Set([r.doc_date]),
        s8Dates: new Set(),
        minutesAll: 0,
        minutesValid: 0,
      });
    }
  }

  for (const l of s8Logs) {
    if (!l.employee_id) continue;
    const key = l.employee_id;
    const existing = byKey.get(key);
    if (existing) {
      existing.minutesAll += l.duration_minutes;
      if (l.duration_minutes >= MIN_BLOCK_MINUTES) {
        existing.minutesValid += l.duration_minutes;
      }
      existing.s8Dates.add(l.log_date);
    } else {
      byKey.set(key, {
        employeeId: l.employee_id,
        displayName: employeeNames.get(l.employee_id) ?? "Inconnu",
        lines: 0,
        waves: 0,
        picklists: 0,
        sapDates: new Set(),
        s8Dates: new Set([l.log_date]),
        minutesAll: l.duration_minutes,
        minutesValid: l.duration_minutes >= MIN_BLOCK_MINUTES ? l.duration_minutes : 0,
      });
    }
  }

  return [...byKey.values()]
    .map((e) => {
      const totalHours = e.minutesAll / 60;
      const validHours = e.minutesValid / 60;
      const hasS8 = e.minutesAll > 0;
      return {
        key: e.employeeId ?? `unmapped:${e.displayName}`,
        employeeId: e.employeeId,
        displayName: e.displayName,
        totalLines: e.lines,
        totalHours,
        validHours,
        linesPerHour: validHours > 0 ? e.lines / validHours : null,
        totalWaves: e.waves,
        totalPicklists: e.picklists,
        linesPerWave: e.waves > 0 ? e.lines / e.waves : null,
        picklistsPerWave: e.waves > 0 ? e.picklists / e.waves : null,
        daysWithSap: e.sapDates.size,
        daysWithS8: e.s8Dates.size,
        insufficientData: hasS8 && validHours === 0,
      };
    })
    .filter((e) => e.totalLines > 0 || e.totalHours > 0)
    .sort((a, b) => {
      // Employés avec l/h valide d'abord (desc), puis N/A par lignes desc
      if (a.linesPerHour != null && b.linesPerHour != null)
        return b.linesPerHour - a.linesPerHour;
      if (a.linesPerHour != null) return -1;
      if (b.linesPerHour != null) return 1;
      return b.totalLines - a.totalLines;
    });
}

export type LogQualityStats = {
  /** Lignes SAP dont le jour n'a aucune heure S8 picking pour cet employé */
  unmatchedLines: number;
  totalLines: number;
  unmatchedPct: number;
  /** Employés triés par nb lignes non matchées (desc) */
  topOffenders: { key: string; displayName: string; unmatchedLines: number }[];
};

/**
 * Calcule les lignes SAP sans S8 picking correspondant.
 * Définition: jour avec line_count > 0 et 0 heure S8 picking ce jour-là pour cet employé.
 */
export function computeLogQuality(
  sapRows: PickingDailyRow[],
  s8Logs: S8PickingLog[],
  employeeNames: Map<string, string>
): LogQualityStats {
  // Ensemble des (employee_id | unmapped_key) + date ayant du S8
  const s8DayKeys = new Set<string>();
  for (const l of s8Logs) {
    if (l.employee_id) s8DayKeys.add(`${l.employee_id}::${l.log_date}`);
  }

  const byEmp = new Map<string, { displayName: string; unmatchedLines: number }>();
  let unmatchedLines = 0;
  const totalLines = sapRows.reduce((s, r) => s + r.line_count, 0);

  for (const r of sapRows) {
    if (r.line_count <= 0) continue;
    const personKey = r.employee_id ?? `unmapped:${r.external_user_name}`;
    const dayKey = r.employee_id ? `${r.employee_id}::${r.doc_date}` : null;
    const hasS8 = dayKey != null && s8DayKeys.has(dayKey);

    if (!hasS8) {
      unmatchedLines += r.line_count;
      const existing = byEmp.get(personKey);
      const displayName = r.employee_id
        ? (employeeNames.get(r.employee_id) ?? r.external_user_name)
        : r.external_user_name;
      if (existing) {
        existing.unmatchedLines += r.line_count;
      } else {
        byEmp.set(personKey, { displayName, unmatchedLines: r.line_count });
      }
    }
  }

  const topOffenders = [...byEmp.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.unmatchedLines - a.unmatchedLines)
    .slice(0, 10);

  return {
    unmatchedLines,
    totalLines,
    unmatchedPct: totalLines > 0 ? (unmatchedLines / totalLines) * 100 : 0,
    topOffenders,
  };
}

export type PickingPeriodBucket = {
  period: string;
  label: string;
  lineCount: number;
  hours: number;
  linesPerHour: number | null;
  waveCount: number;
  picklistCount: number;
};

export function computePickingPeriodBuckets(
  sapRows: PickingDailyRow[],
  s8Logs: S8PickingLog[],
  granularity: Granularity
): PickingPeriodBucket[] {
  const map = new Map<
    string,
    { lines: number; minutes: number; waves: number; picklists: number }
  >();

  for (const r of sapRows) {
    const key = periodKey(r.doc_date, granularity);
    const existing = map.get(key) ?? { lines: 0, minutes: 0, waves: 0, picklists: 0 };
    existing.lines += r.line_count;
    existing.waves += r.wave_count;
    existing.picklists += r.picklist_count;
    map.set(key, existing);
  }

  for (const l of s8Logs) {
    const key = periodKey(l.log_date, granularity);
    const existing = map.get(key) ?? { lines: 0, minutes: 0, waves: 0, picklists: 0 };
    existing.minutes += l.duration_minutes;
    map.set(key, existing);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => {
      const hours = v.minutes / 60;
      return {
        period,
        label:
          granularity === "week"
            ? formatWeekLabel(period)
            : granularity === "month"
              ? period
              : new Date(period + "T12:00:00").toLocaleDateString("fr-CA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
        lineCount: v.lines,
        hours,
        linesPerHour: hours > 0 ? v.lines / hours : null,
        waveCount: v.waves,
        picklistCount: v.picklists,
      };
    });
}
