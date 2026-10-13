import { parseISO, startOfDay, endOfDay, max, min, differenceInMinutes, getISODay } from "date-fns";
import type {
  Employee,
  EmployeeWorkSchedule,
  CapacityEvent,
  EmployeeLeave,
  DayCapacity,
  CapacityEventType,
  NethrisAbsenceReason,
  NethrisAbsenceReasonId,
} from "./supabase/types";
import {
  CAPACITY_EVENT_POSITIVE_TYPES,
  CAPACITY_EVENT_ABSENCE_TYPES,
} from "./supabase/types";

// ─── Statut de présence (grille calendrier) ──────────────────────────────────

export type AttendanceStatus =
  | "present"
  | "partial"
  | "absent"
  | "overtime"
  | "empty"
  | "on_leave"
  | "holiday";

/**
 * Détermine le statut de présence affiché dans la grille calendrier.
 * isOnLeave : employé en congé prolongé → masqué des compteurs
 * isHoliday : jour férié               → cellule neutre
 */
export function getAttendanceStatus(
  cap: DayCapacity,
  isWeekend: boolean,
  isOnLeave = false,
  isHoliday = false,
): AttendanceStatus {
  if (isOnLeave)  return "on_leave";
  if (isHoliday)  return "holiday";

  const hasSchedule = cap.scheduledHours > 0;
  const hasEvents   = cap.events.length > 0;

  if (!hasSchedule && !hasEvents) return "empty";
  if (isWeekend && !hasEvents)    return "empty";

  if (cap.availableHours <= 0 && hasSchedule) return "absent";
  if (cap.overtime > 0)                        return "overtime";
  if (cap.totalNegativeHours > 0)              return "partial";
  return "present";
}

// ─── Congés prolongés ────────────────────────────────────────────────────────

export const LEAVE_REASON_LABELS: Record<string, string> = {
  medical:  "Maladie",
  injury:   "Blessure",
  mental:   "Épuisement / Dépression",
  personal: "Personnel",
  other:    "Congé prolongé",
};

/** Retourne le congé actif de l'employé pour une date donnée, ou null. */
export function getActiveLeave(
  employeeId: string,
  dateStr: string,
  leaves: EmployeeLeave[]
): EmployeeLeave | null {
  return leaves.find((l) => {
    if (l.employee_id !== employeeId) return false;
    if (dateStr < l.start_date) return false;
    if (l.end_date && dateStr > l.end_date) return false;
    return true;
  }) ?? null;
}

/** Retourne true si l'employé est en congé prolongé un jour donné. */
export function isEmployeeOnLeave(
  employeeId: string,
  dateStr: string,
  leaves: EmployeeLeave[]
): boolean {
  return getActiveLeave(employeeId, dateStr, leaves) !== null;
}

/** Retourne true si l'employé a un congé qui chevauche la semaine donnée. */
export function isEmployeeOnLeaveThisWeek(
  employeeId: string,
  weekStartStr: string,
  weekEndStr: string,
  leaves: EmployeeLeave[]
): boolean {
  return leaves.some((l) => {
    if (l.employee_id !== employeeId) return false;
    if (l.start_date > weekEndStr) return false;
    if (l.end_date && l.end_date < weekStartStr) return false;
    return true;
  });
}

// ─── Motifs d'absence (banques Nethris → mots superviseur) ───────────────────

export const NETHRIS_ABSENCE_REASONS: NethrisAbsenceReason[] = [
  { id: "flex",       supervisor_label: "Heure Flex",                              nethris_label: "Banque congés flex",              event_type: "unplanned_absence", sort_order: 1, active: true },
  { id: "unpaid",     supervisor_label: "Absence non payée",                       nethris_label: null,                              event_type: "unplanned_absence", sort_order: 2, active: true },
  { id: "vacation",   supervisor_label: "Vacances",                                nethris_label: "Banque de vacances",              event_type: "planned_absence",   sort_order: 3, active: true },
  { id: "bank_reg",   supervisor_label: "Banque de temps (taux régulier)",         nethris_label: "Payer B.Temps 1,0 (taux reg)",    event_type: "planned_absence",   sort_order: 4, active: true },
  { id: "bank_ot",    supervisor_label: "Banque de temps (temps supplémentaire)",  nethris_label: "Payer B.Temps 1,5 (taux supp)",   event_type: "planned_absence",   sort_order: 5, active: true },
  { id: "initiative", supervisor_label: "Banque initiative",                       nethris_label: "Payer B. Initiative (reg. 1.0)",  event_type: "planned_absence",   sort_order: 6, active: true },
];

export const NETHRIS_ABSENCE_REASON_LABELS: Record<NethrisAbsenceReasonId, string> =
  Object.fromEntries(
    NETHRIS_ABSENCE_REASONS.map((r) => [r.id, r.supervisor_label])
  ) as Record<NethrisAbsenceReasonId, string>;

export function getNethrisReason(id: NethrisAbsenceReasonId | null | undefined): NethrisAbsenceReason | undefined {
  if (!id) return undefined;
  return NETHRIS_ABSENCE_REASONS.find((r) => r.id === id);
}

// ─── Libellés des événements ─────────────────────────────────────────────────

export const EVENT_TYPE_LABELS: Record<CapacityEventType, string> = {
  overtime:          "Overtime",
  part_time_boost:   "Boost temps partiel",
  late:              "Retard",
  early_departure:   "Départ hâtif",
  planned_absence:   "Absence planifiée",
  unplanned_absence: "Absence imprévue",
};

/** Libellé affiché : motif banque si présent, sinon type d'événement. */
export function getEventDisplayLabel(ev: Pick<CapacityEvent, "event_type" | "nethris_reason_id">): string {
  if (ev.nethris_reason_id) {
    return NETHRIS_ABSENCE_REASON_LABELS[ev.nethris_reason_id] ?? EVENT_TYPE_LABELS[ev.event_type];
  }
  return EVENT_TYPE_LABELS[ev.event_type];
}

/** Retourne l'événement dominant (le plus long) pour colorer la cellule absente. */
export function getDominantEvent(cap: DayCapacity): CapacityEvent | null {
  const negEvents = cap.events.filter((e) =>
    !CAPACITY_EVENT_POSITIVE_TYPES.includes(e.event_type)
  );
  if (negEvents.length === 0) return null;
  return negEvents.reduce((best, ev) => {
    const durBest = differenceInMinutes(parseISO(best.end_datetime), parseISO(best.start_datetime));
    const durEv   = differenceInMinutes(parseISO(ev.end_datetime),   parseISO(ev.start_datetime));
    return durEv > durBest ? ev : best;
  });
}

// ─── Tri des employés pour la grille ─────────────────────────────────────────

/**
 * Trie les employés pour la grille.
 * Les employés en congé prolongé sont FILTRÉS (masqués complètement).
 *  1. Employés avec événement(s) dans la semaine
 *  2. Employés présents normalement (avec horaire, sans événement)
 *  3. Employés sans horaire planifié
 */
export function sortEmployeesByPresence(
  employees: Employee[],
  schedules: EmployeeWorkSchedule[],
  events: CapacityEvent[],
  leaves: EmployeeLeave[] = [],
  weekStartStr = "",
  weekEndStr = "",
): Employee[] {
  // Filtrer complètement les employés en congé prolongé
  const activeEmps = employees.filter(
    (emp) => !isEmployeeOnLeaveThisWeek(emp.id, weekStartStr, weekEndStr, leaves)
  );

  function hasEventThisWeek(emp: Employee): boolean {
    return events.some((e) => e.employee_id === emp.id);
  }

  function hasSchedule(emp: Employee): boolean {
    return schedules.some(
      (s) => s.employee_id === emp.id && (s.am_start || s.pm_start)
    );
  }

  const alpha = (a: Employee, b: Employee) => a.full_name.localeCompare(b.full_name, "fr");

  const group1 = activeEmps.filter((e) => hasEventThisWeek(e)).sort(alpha);
  const group2 = activeEmps.filter((e) => !hasEventThisWeek(e) && hasSchedule(e)).sort(alpha);
  const group3 = activeEmps.filter((e) => !hasEventThisWeek(e) && !hasSchedule(e)).sort(alpha);

  return [...group1, ...group2, ...group3];
}

// ─── Versionnage des horaires ─────────────────────────────────────────────────

/**
 * Retourne l'horaire actif pour un employé un jour et une date donnés.
 * Prend en compte effective_from / effective_to pour choisir la bonne version.
 */
export function getScheduleForDate(
  schedules: EmployeeWorkSchedule[],
  employeeId: string,
  dateStr: string,  // "YYYY-MM-DD"
  weekday: number   // 1-5
): EmployeeWorkSchedule | undefined {
  // On filtre tous les records valides pour ce jour, puis on prend celui dont
  // effective_from est le plus récent (record le plus spécifique gagne).
  // Les anciens records sans effective_from sont traités comme valides depuis toujours.
  const candidates = schedules.filter(
    (s) =>
      s.employee_id === employeeId &&
      s.weekday === weekday &&
      (!s.effective_from || s.effective_from <= dateStr) &&
      (s.effective_to === null || s.effective_to === undefined || s.effective_to >= dateStr)
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort(
    (a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? "")
  )[0];
}

// ─── Utilitaires horaires ─────────────────────────────────────────────────────

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
  const overlapEnd   = min([aEnd, bEnd]);
  const mins = differenceInMinutes(overlapEnd, overlapStart);
  return mins > 0 ? mins / 60 : 0;
}

// ─── Calcul principal ─────────────────────────────────────────────────────────

export function computeDayCapacity(
  employee: Employee,
  dateStr: string,      // "YYYY-MM-DD"
  schedule: EmployeeWorkSchedule | undefined,
  events: CapacityEvent[]
): DayCapacity {
  const dayStart = startOfDay(new Date(dateStr + "T00:00:00"));
  const dayEnd   = endOfDay(new Date(dateStr + "T00:00:00"));

  // 1. Heures normales planifiées
  const scheduledHours =
    (schedule ? blockDuration(schedule.am_start, schedule.am_end) : 0) +
    (schedule ? blockDuration(schedule.pm_start, schedule.pm_end) : 0);

  // 2. Filtrer les événements du jour
  const dayEvents = events.filter((ev) => {
    const evStart = parseISO(ev.start_datetime);
    const evEnd   = parseISO(ev.end_datetime);
    return evStart < dayEnd && evEnd > dayStart;
  });

  // 3. Heures d'absence intersectées avec les blocs horaires planifiés
  let absenceHours = 0;
  const absenceEvents = dayEvents.filter((ev) =>
    CAPACITY_EVENT_ABSENCE_TYPES.includes(ev.event_type)
  );

  for (const ev of absenceEvents) {
    const evStart = parseISO(ev.start_datetime);
    const evEnd   = parseISO(ev.end_datetime);

    // Intersection avec bloc AM
    if (schedule?.am_start && schedule?.am_end) {
      const amStart = timeToDate(dateStr, schedule.am_start);
      const amEnd   = timeToDate(dateStr, schedule.am_end);
      absenceHours += overlapHours(evStart, evEnd, amStart, amEnd);
    }

    // Intersection avec bloc PM
    if (schedule?.pm_start && schedule?.pm_end) {
      const pmStart = timeToDate(dateStr, schedule.pm_start);
      const pmEnd   = timeToDate(dateStr, schedule.pm_end);
      absenceHours += overlapHours(evStart, evEnd, pmStart, pmEnd);
    }
  }

  // 4. Retards / départs hâtifs (durée brute dans la journée)
  let timingLossHours = 0;
  const timingEvents = dayEvents.filter(
    (ev) => ev.event_type === "late" || ev.event_type === "early_departure"
  );

  for (const ev of timingEvents) {
    const evStart = max([parseISO(ev.start_datetime), dayStart]);
    const evEnd   = min([parseISO(ev.end_datetime),   dayEnd]);
    timingLossHours += differenceInMinutes(evEnd, evStart) / 60;
  }

  // 5. Heures positives (overtime + part_time_boost — durée brute dans la journée)
  let positiveEventHours = 0;
  const positiveEvents = dayEvents.filter((ev) =>
    CAPACITY_EVENT_POSITIVE_TYPES.includes(ev.event_type)
  );

  for (const ev of positiveEvents) {
    const evStart = max([parseISO(ev.start_datetime), dayStart]);
    const evEnd   = min([parseISO(ev.end_datetime),   dayEnd]);
    positiveEventHours += differenceInMinutes(evEnd, evStart) / 60;
  }

  // 6. Formule centrale
  const totalNegativeHours = absenceHours + timingLossHours;
  const availableHours = scheduledHours + positiveEventHours - totalNegativeHours;
  const overtime = availableHours - scheduledHours;

  return {
    employee,
    date: dateStr,
    scheduledHours,
    absenceHours,
    timingLossHours,
    positiveEventHours,
    totalNegativeHours,
    availableHours: Math.max(0, availableHours),
    overtime,
    events: dayEvents,
  };
}

/** weekday ISO (1=lundi, 7=dimanche) → numéro de weekday DB (1–5) */
export function isoWeekdayToScheduleDay(isoDay: number): number | null {
  if (isoDay >= 1 && isoDay <= 5) return isoDay;
  return null;
}

/** Retourne la couleur de statut d'une cellule (legacy — utilisé dans certains KPI) */
export function getCellStatus(
  cap: DayCapacity,
  isWeekend: boolean
): "normal" | "adjusted" | "absent" | "overtime" | "empty" {
  if (isWeekend) {
    if (cap.events.length === 0) return "empty";
    return cap.overtime > 0 ? "overtime" : "adjusted";
  }
  if (cap.scheduledHours === 0 && cap.events.length === 0) return "empty";
  if (cap.availableHours <= 0) return "absent";
  if (cap.overtime > 0) return "overtime";
  if (cap.totalNegativeHours > 0) return "adjusted";
  if (cap.positiveEventHours > 0) return "overtime";
  return "normal";
}

export const STATUS_COLORS = {
  normal:   "bg-green-50 border-green-200 text-green-900",
  adjusted: "bg-orange-50 border-orange-200 text-orange-900",
  absent:   "bg-red-50 border-red-200 text-red-900",
  overtime: "bg-blue-50 border-blue-200 text-blue-900",
  empty:    "bg-gray-50 border-gray-200 text-gray-400",
} as const;

export const STATUS_DOT_COLORS = {
  normal:   "bg-green-500",
  adjusted: "bg-orange-500",
  absent:   "bg-red-500",
  overtime: "bg-blue-500",
  empty:    "bg-gray-300",
} as const;

/** Formate un nombre d'heures en "4h30" */
export function formatHours(h: number): string {
  if (h === 0) return "0h";
  const sign = h < 0 ? "-" : "";
  const abs  = Math.abs(h);
  const hours = Math.floor(abs);
  const mins  = Math.round((abs - hours) * 60);
  if (mins === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h${mins.toString().padStart(2, "0")}`;
}
