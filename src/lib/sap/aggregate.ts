import {
  buildPickingExternalKey,
  buildWaveExternalKey,
  type PickingDailyRow,
  type PickingWaveRow,
} from "@/lib/picking";
import {
  parseDiscrepancy,
  parseCountDate,
  matchEmployee,
  type EmployeeMapping,
  type InventoryLine,
} from "@/lib/inventory";
import {
  buildExternalKey,
  parseSapDocDate,
  toPeriodMonth,
  type ReceivingDailyRow,
} from "@/lib/receiving";
import type { PackagingDailyRow } from "@/lib/packaging";
import type {
  SapInventoryLine,
  SapPickingLine,
  SapReceivingLine,
} from "./client";
import type { MonthTotals } from "./types";

export type { MonthTotals } from "./types";

export type DailyAgg = {
  externalKey: string;
  userCode: string | null;
  userName: string;
  employeeId: string | null;
  docDate: string;
  periodMonth: string;
  lineCount: number;
  waveCount: number;
  picklistCount: number;
};

export type WaveAgg = {
  externalKey: string;
  waveKey: string;
  periodMonth: string;
  docDate: string;
  lineCount: number;
  picklistCount: number;
};

function normalizeDate(raw: string): string | null {
  return parseSapDocDate(raw) ?? parseCountDate(raw);
}

/** Agrège lignes item picking/emballage → employé×jour + vagues. */
export function aggregatePickingLike(
  lines: SapPickingLine[],
  mappings: EmployeeMapping[]
): { days: DailyAgg[]; waves: WaveAgg[] } {
  type Day = {
    userCode: string | null;
    userName: string;
    docDate: string;
    waves: Set<string>;
    picklists: Set<string>;
    lineCount: number;
  };
  type Wave = {
    waveKey: string;
    periodMonth: string;
    docDate: string;
    lineCount: number;
    picklists: Set<string>;
  };

  const dayMap = new Map<string, Day>();
  const waveMap = new Map<string, Wave>();

  for (const row of lines) {
    const userCode = String(row.userCode ?? "").trim() || null;
    const userName = String(row.userName ?? "").trim();
    const docDate = normalizeDate(String(row.createDate ?? ""));
    if (!docDate) continue;
    if (!userCode && !userName) continue;

    const wave = String(row.waveKey ?? "").trim();
    const picklist =
      row.pickListNumber != null && row.pickListNumber !== undefined
        ? String(row.pickListNumber).trim()
        : "";

    if (wave) {
      const periodMonth = toPeriodMonth(docDate);
      const wKey = buildWaveExternalKey(periodMonth, wave);
      const existing = waveMap.get(wKey);
      if (existing) {
        existing.lineCount += 1;
        if (picklist) existing.picklists.add(picklist);
        if (docDate < existing.docDate) existing.docDate = docDate;
      } else {
        waveMap.set(wKey, {
          waveKey: wave,
          periodMonth,
          docDate,
          lineCount: 1,
          picklists: new Set(picklist ? [picklist] : []),
        });
      }
    }

    const key = buildPickingExternalKey(docDate, userCode, userName);
    const existing = dayMap.get(key);
    if (existing) {
      existing.lineCount += 1;
      if (wave) existing.waves.add(wave);
      if (picklist) existing.picklists.add(picklist);
      if (!existing.userName && userName) existing.userName = userName;
      if (!existing.userCode && userCode) existing.userCode = userCode;
    } else {
      dayMap.set(key, {
        userCode,
        userName: userName || userCode || "?",
        docDate,
        waves: new Set(wave ? [wave] : []),
        picklists: new Set(picklist ? [picklist] : []),
        lineCount: 1,
      });
    }
  }

  const days: DailyAgg[] = [...dayMap.entries()].map(([externalKey, a]) => ({
    externalKey,
    userCode: a.userCode,
    userName: a.userName,
    employeeId: matchEmployee(a.userCode, a.userName, mappings),
    docDate: a.docDate,
    periodMonth: toPeriodMonth(a.docDate),
    lineCount: a.lineCount,
    waveCount: a.waves.size,
    picklistCount: a.picklists.size,
  }));

  const waves: WaveAgg[] = [...waveMap.entries()].map(([externalKey, w]) => ({
    externalKey,
    waveKey: w.waveKey,
    periodMonth: w.periodMonth,
    docDate: w.docDate,
    lineCount: w.lineCount,
    picklistCount: w.picklists.size,
  }));

  return { days, waves };
}

export function aggregateReceiving(
  lines: SapReceivingLine[],
  mappings: EmployeeMapping[]
): DailyAgg[] {
  return lines
    .map((row) => {
      const userName = String(row.employeeName ?? "").trim();
      const docDate = normalizeDate(String(row.docDate ?? ""));
      const lineCount = Number(row.count) || 0;
      if (!userName || !docDate) return null;
      return {
        externalKey: buildExternalKey(docDate, userName),
        userCode: null as string | null,
        userName,
        employeeId: matchEmployee(null, userName, mappings),
        docDate,
        periodMonth: toPeriodMonth(docDate),
        lineCount,
        waveCount: 0,
        picklistCount: 0,
      };
    })
    .filter((x): x is DailyAgg => x != null);
}

export type InvAgg = {
  externalId: string;
  userName: string;
  employeeId: string | null;
  countDate: string;
  periodMonth: string;
  itemCode: string | null;
  location: string | null;
  hasDiscrepancy: boolean;
  /** Clé stable pour comparer sans id wrapper */
  compareKey: string;
};

export function aggregateInventory(
  lines: SapInventoryLine[],
  mappings: EmployeeMapping[]
): InvAgg[] {
  return lines
    .map((row) => {
      const countDate = normalizeDate(String(row.date ?? ""));
      if (!countDate) return null;
      const userName = String(row.userName ?? "").trim() || "?";
      const itemCode = String(row.itemCode ?? "").trim() || null;
      const location = String(row.location ?? "").trim() || null;
      const hasDiscrepancy = parseDiscrepancy(row.result);
      const compareKey = [
        countDate,
        userName.trim().toLowerCase(),
        (itemCode ?? "").toLowerCase(),
        (location ?? "").toLowerCase(),
        hasDiscrepancy ? "1" : "0",
      ].join("|");
      return {
        externalId: String(row.id ?? compareKey),
        userName,
        employeeId: matchEmployee(null, userName, mappings),
        countDate,
        periodMonth: toPeriodMonth(countDate),
        itemCode,
        location,
        hasDiscrepancy,
        compareKey,
      };
    })
    .filter((x): x is InvAgg => x != null);
}

export function totalsFromDays(days: DailyAgg[], waves?: WaveAgg[]): MonthTotals {
  return {
    lineCount: days.reduce((s, d) => s + d.lineCount, 0),
    waveCount: waves
      ? waves.length
      : days.reduce((s, d) => s + d.waveCount, 0),
    picklistCount: waves
      ? waves.reduce((s, w) => s + w.picklistCount, 0)
      : days.reduce((s, d) => s + d.picklistCount, 0),
    dayRows: days.length,
  };
}

export function toPickingDailyRows(days: DailyAgg[]): PickingDailyRow[] {
  return days.map((d) => ({
    id: d.externalKey,
    employee_id: d.employeeId,
    external_user_code: d.userCode,
    external_user_name: d.userName,
    doc_date: d.docDate,
    period_month: d.periodMonth,
    line_count: d.lineCount,
    wave_count: d.waveCount,
    picklist_count: d.picklistCount,
  }));
}

export function toPackagingDailyRows(days: DailyAgg[]): PackagingDailyRow[] {
  return toPickingDailyRows(days) as PackagingDailyRow[];
}

export function toWaveRows(waves: WaveAgg[]): PickingWaveRow[] {
  return waves.map((w) => ({
    id: w.externalKey,
    wave_key: w.waveKey,
    period_month: w.periodMonth,
    doc_date: w.docDate,
    line_count: w.lineCount,
    picklist_count: w.picklistCount,
  }));
}

export function toReceivingDailyRows(days: DailyAgg[]): ReceivingDailyRow[] {
  return days.map((d) => ({
    id: d.externalKey,
    employee_id: d.employeeId,
    external_user_name: d.userName,
    doc_date: d.docDate,
    period_month: d.periodMonth,
    line_count: d.lineCount,
  }));
}

export function toInventoryLines(rows: InvAgg[]): InventoryLine[] {
  return rows.map((r) => ({
    id: r.externalId,
    employee_id: r.employeeId,
    external_user_name: r.userName,
    external_user_code: null,
    count_date: r.countDate,
    period_month: r.periodMonth,
    item_code: r.itemCode,
    location: r.location,
    has_discrepancy: r.hasDiscrepancy,
  }));
}
