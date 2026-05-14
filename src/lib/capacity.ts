import { parseISO, startOfDay, endOfDay, max, min, differenceInMinutes, getISODay } from "date-fns";
import type {
  Employee,
  EmployeeWorkSchedule,
  EmployeeExclusionWithType,
  EmployeeAdjustment,
  DayCapacity,
} from "./supabase/types";

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/** Convertit "HH:mm:ss" ou "HH:mm" + une date de référence en Date */
function timeToDate(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d;
}

/** Durée en heures entre deux "HH:mm" */
function blockDuration(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

/** Chevauchement en heures entre [aStart, aEnd] et [bStart, bEnd] */
function overlapHours(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const overlapStart = max([aStart, bStart]);
  const overlapEnd = min([aEnd, bEnd]);
  const mins = differenceInMinutes(overlapEnd, overlapStart);
  return mins > 0 ? mins / 60 : 0;
}

// ─── Calcul principal ─────────────────────────────────────────────────────────

export function computeDayCapacity(
  employee: Employee,
  dateStr: string, // "YYYY-MM-DD"
  schedule: EmployeeWorkSchedule | undefined,
  exclusions: EmployeeExclusionWithType[],
  adjustments: EmployeeAdjustment[]
): DayCapacity {
  // 1. Heures normales planifiées
  const scheduledHours =
    (schedule ? blockDuration(schedule.am_start, schedule.am_end) : 0) +
    (schedule ? blockDuration(schedule.pm_start, schedule.pm_end) : 0);

  // 2. Heures d'exclusion intersectées avec les blocs normaux
  let exclusionHours = 0;

  const dayExclusions = exclusions.filter((ex) => {
    const exStart = parseISO(ex.start_datetime);
    const exEnd = parseISO(ex.end_datetime);
    const dayStart = startOfDay(new Date(dateStr + "T00:00:00"));
    const dayEnd = endOfDay(new Date(dateStr + "T00:00:00"));
    return exStart < dayEnd && exEnd > dayStart;
  });

  for (const ex of dayExclusions) {
    const exStart = parseISO(ex.start_datetime);
    const exEnd = parseISO(ex.end_datetime);

    // Intersection avec bloc AM
    if (schedule?.am_start && schedule?.am_end) {
      const amStart = timeToDate(dateStr, schedule.am_start);
      const amEnd = timeToDate(dateStr, schedule.am_end);
      exclusionHours += overlapHours(exStart, exEnd, amStart, amEnd);
    }

    // Intersection avec bloc PM
    if (schedule?.pm_start && schedule?.pm_end) {
      const pmStart = timeToDate(dateStr, schedule.pm_start);
      const pmEnd = timeToDate(dateStr, schedule.pm_end);
      exclusionHours += overlapHours(exStart, exEnd, pmStart, pmEnd);
    }
  }

  // 3. Ajustements
  const dayAdjustments = adjustments.filter((adj) => {
    const adjStart = parseISO(adj.start_datetime);
    const adjEnd = parseISO(adj.end_datetime);
    const dayStart = startOfDay(new Date(dateStr + "T00:00:00"));
    const dayEnd = endOfDay(new Date(dateStr + "T00:00:00"));
    return adjStart < dayEnd && adjEnd > dayStart;
  });

  let positiveAdjustmentHours = 0;
  let negativeAdjustmentHours = 0;

  for (const adj of dayAdjustments) {
    const adjStart = max([parseISO(adj.start_datetime), startOfDay(new Date(dateStr + "T00:00:00"))]);
    const adjEnd = min([parseISO(adj.end_datetime), endOfDay(new Date(dateStr + "T00:00:00"))]);
    const hours = differenceInMinutes(adjEnd, adjStart) / 60;
    if (adj.direction === "positive") positiveAdjustmentHours += hours;
    else negativeAdjustmentHours += hours;
  }

  // 4. Formule centrale
  const availableHours =
    scheduledHours + positiveAdjustmentHours - exclusionHours - negativeAdjustmentHours;

  // 5. Overtime analytique
  const overtime = availableHours - scheduledHours;

  return {
    employee,
    date: dateStr,
    scheduledHours,
    exclusionHours,
    positiveAdjustmentHours,
    negativeAdjustmentHours,
    availableHours: Math.max(0, availableHours),
    overtime,
    exclusions: dayExclusions,
    adjustments: dayAdjustments,
  };
}

/** weekday ISO (1=lundi, 7=dimanche) → numéro de weekday de la DB (1–5) */
export function isoWeekdayToScheduleDay(isoDay: number): number | null {
  if (isoDay >= 1 && isoDay <= 5) return isoDay;
  return null;
}

/** Retourne la couleur de statut d'une cellule */
export function getCellStatus(
  cap: DayCapacity,
  isWeekend: boolean
): "normal" | "adjusted" | "absent" | "overtime" | "empty" {
  if (isWeekend) {
    if (cap.adjustments.length === 0) return "empty";
    return cap.overtime > 0 ? "overtime" : "adjusted";
  }
  if (cap.scheduledHours === 0 && cap.adjustments.length === 0) return "empty";
  if (cap.availableHours <= 0) return "absent";
  if (cap.overtime > 0) return "overtime";
  if (cap.exclusionHours > 0 || cap.negativeAdjustmentHours > 0) return "adjusted";
  if (cap.positiveAdjustmentHours > 0) return "overtime";
  return "normal";
}

export const STATUS_COLORS = {
  normal: "bg-green-50 border-green-200 text-green-900",
  adjusted: "bg-orange-50 border-orange-200 text-orange-900",
  absent: "bg-red-50 border-red-200 text-red-900",
  overtime: "bg-blue-50 border-blue-200 text-blue-900",
  empty: "bg-gray-50 border-gray-200 text-gray-400",
} as const;

export const STATUS_DOT_COLORS = {
  normal: "bg-green-500",
  adjusted: "bg-orange-500",
  absent: "bg-red-500",
  overtime: "bg-blue-500",
  empty: "bg-gray-300",
} as const;

/** Formate un nombre d'heures en "4h30" */
export function formatHours(h: number): string {
  if (h === 0) return "0h";
  const sign = h < 0 ? "-" : "";
  const abs = Math.abs(h);
  const hours = Math.floor(abs);
  const mins = Math.round((abs - hours) * 60);
  if (mins === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h${mins.toString().padStart(2, "0")}`;
}
