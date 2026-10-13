// ─── Receiving KPI utilities ───────────────────────────────────────────────

import { findColumnIndex } from "./production";
import { matchEmployee, periodKey, formatWeekLabel, type EmployeeMapping, type Granularity } from "./inventory";

export type ReceivingDailyRow = {
  id: string;
  employee_id: string | null;
  external_user_name: string;
  doc_date: string;
  period_month: string;
  line_count: number;
};

export type S8ReceivingLog = {
  employee_id: string | null;
  log_date: string;
  duration_minutes: number;
};

/** Parse DocDate SAP : YYYYMMDD, YYYY-MM-DD, DD/MM/YYYY ou Date Excel */
export function parseSapDocDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const s = String(value);
    if (s.length === 8) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const str = String(value).trim();

  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const fr = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (fr) {
    const [, d, m, y] = fr;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }

  const d = new Date(str.replace(" ", "T"));
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

export function toPeriodMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function buildExternalKey(docDate: string, userName: string): string {
  return `${docDate}_${userName.trim().toLowerCase()}`;
}

export const RECEIVING_COLUMN_ALIASES = {
  date: ["docdate", "date", "dateenregistrement"],
  user: ["employe", "uname", "username", "nom"],
  lines: ["lignes", "count", "nombre"],
};

export function findReceivingColumns(headers: string[]) {
  return {
    dateCol: findColumnIndex(headers, RECEIVING_COLUMN_ALIASES.date),
    userCol: findColumnIndex(headers, RECEIVING_COLUMN_ALIASES.user),
    linesCol: findColumnIndex(headers, RECEIVING_COLUMN_ALIASES.lines),
  };
}

export { matchEmployee, periodKey, formatWeekLabel, type EmployeeMapping, type Granularity };

export type TeamReceivingSummary = {
  totalLines: number;
  totalHours: number;
  linesPerHour: number | null;
  activeEmployees: number;
  avgLinesPerHour: number | null;
};

export function computeTeamReceivingSummary(
  sapRows: ReceivingDailyRow[],
  s8Logs: S8ReceivingLog[]
): TeamReceivingSummary {
  const totalLines = sapRows.reduce((s, r) => s + r.line_count, 0);
  const totalMinutes = s8Logs.reduce((s, r) => s + r.duration_minutes, 0);
  const totalHours = totalMinutes / 60;
  const employeeIds = new Set<string>();
  for (const r of sapRows) {
    if (r.employee_id) employeeIds.add(r.employee_id);
  }
  for (const l of s8Logs) {
    if (l.employee_id) employeeIds.add(l.employee_id);
  }

  return {
    totalLines,
    totalHours,
    linesPerHour: totalHours > 0 ? totalLines / totalHours : null,
    activeEmployees: employeeIds.size,
    avgLinesPerHour: null,
  };
}

export type EmployeeReceivingSummary = {
  key: string;
  employeeId: string | null;
  displayName: string;
  totalLines: number;
  totalHours: number;
  linesPerHour: number | null;
  daysWithSap: number;
  daysWithS8: number;
};

export function computeEmployeeReceivingSummaries(
  sapRows: ReceivingDailyRow[],
  s8Logs: S8ReceivingLog[],
  employeeNames: Map<string, string>,
  includedEmployeeIds: Set<string>
): EmployeeReceivingSummary[] {
  const byKey = new Map<
    string,
    {
      employeeId: string | null;
      displayName: string;
      lines: number;
      sapDates: Set<string>;
      s8Dates: Set<string>;
      minutes: number;
    }
  >();

  for (const r of sapRows) {
    if (!r.employee_id) continue;
    if (!includedEmployeeIds.has(r.employee_id)) continue;
    const key = r.employee_id;
    const existing = byKey.get(key);
    if (existing) {
      existing.lines += r.line_count;
      existing.sapDates.add(r.doc_date);
    } else {
      byKey.set(key, {
        employeeId: r.employee_id,
        displayName: employeeNames.get(r.employee_id) ?? r.external_user_name,
        lines: r.line_count,
        sapDates: new Set([r.doc_date]),
        s8Dates: new Set(),
        minutes: 0,
      });
    }
  }

  for (const l of s8Logs) {
    if (!l.employee_id || !includedEmployeeIds.has(l.employee_id)) continue;
    const key = l.employee_id;
    const existing = byKey.get(key);
    if (existing) {
      existing.minutes += l.duration_minutes;
      existing.s8Dates.add(l.log_date);
    } else {
      byKey.set(key, {
        employeeId: l.employee_id,
        displayName: employeeNames.get(l.employee_id) ?? "Inconnu",
        lines: 0,
        sapDates: new Set(),
        s8Dates: new Set([l.log_date]),
        minutes: l.duration_minutes,
      });
    }
  }

  return [...byKey.values()]
    .map((e) => {
      const hours = e.minutes / 60;
      return {
        key: e.employeeId!,
        employeeId: e.employeeId,
        displayName: e.displayName,
        totalLines: e.lines,
        totalHours: hours,
        linesPerHour: hours > 0 ? e.lines / hours : null,
        daysWithSap: e.sapDates.size,
        daysWithS8: e.s8Dates.size,
      };
    })
    .filter((e) => e.totalLines > 0 || e.totalHours > 0)
    .sort((a, b) => (b.linesPerHour ?? 0) - (a.linesPerHour ?? 0));
}

export type ReceivingPeriodBucket = {
  period: string;
  label: string;
  lineCount: number;
};

export function computeReceivingPeriodBuckets(
  rows: ReceivingDailyRow[],
  granularity: Granularity
): ReceivingPeriodBucket[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = periodKey(r.doc_date, granularity);
    map.set(key, (map.get(key) ?? 0) + r.line_count);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, lineCount]) => ({
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
      lineCount,
    }));
}
