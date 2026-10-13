// ─── Inventory KPI utilities ───────────────────────────────────────────────

import { findColumnIndex } from "./production";

export type InventoryLine = {
  id: string;
  employee_id: string | null;
  external_user_name: string;
  external_user_code: string | null;
  count_date: string;
  period_month: string;
  item_code: string | null;
  location: string | null;
  has_discrepancy: boolean;
};

export type EmployeeMapping = {
  employee_id: string;
  external_employee_code: string | null;
  external_employee_name: string | null;
  employees: { full_name: string } | null;
};

/** Parse une date string ou Excel → YYYY-MM-DD */
export function parseCountDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const d = new Date(str.replace(" ", "T"));
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

export function toPeriodMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** RESULT SAP : Oui (conforme) = 0, Non (écart d'inventaire) = 1 */
export function parseDiscrepancy(value: unknown): boolean {
  if (value == null || value === "") return false;
  const n = typeof value === "number" ? value : parseInt(String(value).trim(), 10);
  return n === 1;
}

export function matchEmployee(
  userCode: string | null,
  userName: string,
  mappings: EmployeeMapping[]
): string | null {
  const code = userCode?.trim();
  const name = userName.trim().toLowerCase();

  if (code) {
    const byCode = mappings.find(
      (m) => m.external_employee_code?.trim() === code
    );
    if (byCode) return byCode.employee_id;
  }

  const byName = mappings.find(
    (m) => m.external_employee_name?.trim().toLowerCase() === name
  );
  if (byName) return byName.employee_id;

  return null;
}

export function getEmployeeDisplayName(
  employeeId: string | null,
  externalUserName: string,
  mappings: EmployeeMapping[],
  employeeNames: Map<string, string>
): string {
  if (employeeId) {
    const mapped = employeeNames.get(employeeId);
    if (mapped) return mapped;
    const m = mappings.find((x) => x.employee_id === employeeId);
    if (m?.employees?.full_name) return m.employees.full_name;
  }
  return externalUserName || "Non mappé";
}

/** Lundi de la semaine ISO pour une date YYYY-MM-DD */
export function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + "T12:00:00");
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) =>
    x.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
  return `${fmt(d)} – ${fmt(end)}`;
}

export type Granularity = "day" | "week" | "month";

export function periodKey(dateStr: string, granularity: Granularity): string {
  if (granularity === "day") return dateStr;
  if (granularity === "week") return weekKey(dateStr);
  return toPeriodMonth(dateStr);
}

export type TeamSummary = {
  totalLines: number;
  activeEmployees: number;
  qualityPct: number;
  discrepancyCount: number;
  goalProgressPct: number;
  monthlyGoalPerEmployee: number;
};

export function computeTeamSummary(
  rows: InventoryLine[],
  monthlyGoalPerEmployee: number
): TeamSummary {
  const employeeIds = new Set(
    rows.map((r) => r.employee_id ?? `unmapped:${r.external_user_name}`)
  );
  const activeEmployees = employeeIds.size;
  const discrepancyCount = rows.filter((r) => r.has_discrepancy).length;
  const qualityPct =
    rows.length > 0 ? ((rows.length - discrepancyCount) / rows.length) * 100 : 0;
  const teamGoal =
    monthlyGoalPerEmployee * Math.max(activeEmployees, 1);
  const goalProgressPct =
    teamGoal > 0 ? (rows.length / teamGoal) * 100 : 0;

  return {
    totalLines: rows.length,
    activeEmployees,
    qualityPct,
    discrepancyCount,
    goalProgressPct,
    monthlyGoalPerEmployee,
  };
}

export type EmployeeSummary = {
  key: string;
  employeeId: string | null;
  displayName: string;
  lineCount: number;
  discrepancyCount: number;
  qualityPct: number;
  goalPct: number;
  monthlyGoal: number;
};

export function computeEmployeeSummaries(
  rows: InventoryLine[],
  mappings: EmployeeMapping[],
  employeeNames: Map<string, string>,
  monthlyGoalPerEmployee: number
): EmployeeSummary[] {
  const byKey = new Map<
    string,
    {
      employeeId: string | null;
      displayName: string;
      lines: InventoryLine[];
    }
  >();

  for (const r of rows) {
    const key = r.employee_id ?? `unmapped:${r.external_user_name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.lines.push(r);
    } else {
      byKey.set(key, {
        employeeId: r.employee_id,
        displayName: getEmployeeDisplayName(
          r.employee_id,
          r.external_user_name,
          mappings,
          employeeNames
        ),
        lines: [r],
      });
    }
  }

  return [...byKey.values()]
    .map(({ employeeId, displayName, lines }) => {
      const discrepancyCount = lines.filter((l) => l.has_discrepancy).length;
      const qualityPct =
        lines.length > 0
          ? ((lines.length - discrepancyCount) / lines.length) * 100
          : 0;
      const goalPct =
        monthlyGoalPerEmployee > 0
          ? (lines.length / monthlyGoalPerEmployee) * 100
          : 0;
      return {
        key: employeeId ?? `unmapped:${lines[0]!.external_user_name}`,
        employeeId,
        displayName,
        lineCount: lines.length,
        discrepancyCount,
        qualityPct,
        goalPct,
        monthlyGoal: monthlyGoalPerEmployee,
      };
    })
    .sort((a, b) => b.lineCount - a.lineCount);
}

export type PeriodBucket = {
  period: string;
  label: string;
  lineCount: number;
  discrepancyCount: number;
};

export function computePeriodBuckets(
  rows: InventoryLine[],
  granularity: Granularity
): PeriodBucket[] {
  const map = new Map<string, { lines: number; discrepancies: number }>();

  for (const r of rows) {
    const key = periodKey(r.count_date, granularity);
    const existing = map.get(key) ?? { lines: 0, discrepancies: 0 };
    existing.lines += 1;
    if (r.has_discrepancy) existing.discrepancies += 1;
    map.set(key, existing);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
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
      lineCount: data.lines,
      discrepancyCount: data.discrepancies,
    }));
}

/** Lit un fichier CSV simple (séparateur , ou ;) */
export async function readCsvFile(
  file: File
): Promise<{ headers: string[]; rows: unknown[][] }> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const sep = lines[0]!.includes(";") ? ";" : ",";
  const parseRow = (line: string) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === sep && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]!).map((h) => h.replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map(parseRow) as unknown[][];
  return { headers, rows };
}

export const INVENTORY_COLUMN_ALIASES = {
  id: ["id"],
  userId: ["userid", "usercode", "user"],
  userName: ["uname", "username", "nom", "employe"],
  date: ["date", "ts"],
  item: ["itemcode", "item", "article"],
  location: ["location", "emplacement"],
  result: ["result", "resultat"],
};

export function findInventoryColumns(headers: string[]) {
  return {
    idCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.id),
    userIdCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.userId),
    userNameCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.userName),
    dateCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.date),
    itemCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.item),
    locationCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.location),
    resultCol: findColumnIndex(headers, INVENTORY_COLUMN_ALIASES.result),
  };
}
