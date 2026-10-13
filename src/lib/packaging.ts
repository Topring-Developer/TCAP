// ─── Emballage (Expédition) KPI utilities ──────────────────────────────────
// Même structure que le picking : lignes SAP ÷ heures TWMS département Expédition

import { findColumnIndex } from "./production";
import {
  matchEmployee,
  periodKey,
  formatWeekLabel,
  type EmployeeMapping,
  type Granularity,
} from "./inventory";
import { parseSapDocDate, toPeriodMonth } from "./receiving";

export type PackagingDailyRow = {
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

export type S8PackagingLog = {
  employee_id: string | null;
  log_date: string;
  duration_minutes: number;
};

export { matchEmployee, periodKey, formatWeekLabel, parseSapDocDate, toPeriodMonth };
export type { EmployeeMapping, Granularity };

export function buildPackagingExternalKey(
  docDate: string,
  userCode: string | null,
  userName: string
): string {
  const id = (userCode?.trim() || userName.trim().toLowerCase()).replace(/\s+/g, "_");
  return `${docDate}_${id}`;
}

/** Colonnes SAP emballage (souvent FR) + alias EN proches du picking */
export const PACKAGING_COLUMN_ALIASES = {
  code: [
    "codeutilisateur",
    "code",
    "usercode",
    "userid",
    "u_id",
  ],
  name: [
    "nomdelutilisateur",
    "nomdelutilis",
    "nomutilisateur",
    "nom",
    "username",
    "uname",
    "employe",
  ],
  date: ["createdate", "date", "docdate", "packdate"],
  wave: ["wavekey", "wave", "vague"],
  picklist: ["picklistnumber", "picklistnumb", "picklist", "picklistnum"],
};

export function findPackagingColumns(headers: string[]) {
  return {
    codeCol: findColumnIndex(headers, PACKAGING_COLUMN_ALIASES.code),
    nameCol: findColumnIndex(headers, PACKAGING_COLUMN_ALIASES.name),
    dateCol: findColumnIndex(headers, PACKAGING_COLUMN_ALIASES.date),
    waveCol: findColumnIndex(headers, PACKAGING_COLUMN_ALIASES.wave),
    picklistCol: findColumnIndex(headers, PACKAGING_COLUMN_ALIASES.picklist),
  };
}
