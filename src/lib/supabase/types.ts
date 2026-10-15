export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: Employee;
        Insert: EmployeeInsert;
        Update: EmployeeUpdate;
      };
      employee_work_schedule: {
        Row: EmployeeWorkSchedule;
        Insert: EmployeeWorkScheduleInsert;
        Update: EmployeeWorkScheduleUpdate;
      };
      capacity_events: {
        Row: CapacityEvent;
        Insert: CapacityEventInsert;
        Update: CapacityEventUpdate;
      };
      nethris_absence_reasons: {
        Row: NethrisAbsenceReason;
        Insert: NethrisAbsenceReason;
        Update: Partial<NethrisAbsenceReason>;
      };
      employee_leaves: {
        Row: EmployeeLeave;
        Insert: EmployeeLeaveInsert;
        Update: EmployeeLeaveUpdate;
      };
      // Tables legacy conservées en base mais non utilisées dans l'UI
      exclusion_types: {
        Row: ExclusionType;
        Insert: ExclusionTypeInsert;
        Update: ExclusionTypeUpdate;
      };
      employee_exclusions: {
        Row: EmployeeExclusion;
        Insert: EmployeeExclusionInsert;
        Update: EmployeeExclusionUpdate;
      };
      employee_adjustments: {
        Row: EmployeeAdjustment;
        Insert: EmployeeAdjustmentInsert;
        Update: EmployeeAdjustmentUpdate;
      };
    };
  };
}

export interface Employee {
  id: string;
  full_name: string;
  is_active: boolean;
  employment_type: "full_time" | "part_time";
  include_in_receiving_kpi: boolean;
  hired_at: string | null;       // YYYY-MM-DD — null = date inconnue
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeInsert = Omit<Employee, "id" | "created_at" | "updated_at" | "deactivated_at" | "employment_type" | "include_in_receiving_kpi" | "hired_at"> & {
  hired_at?: string | null;
  deactivated_at?: string | null;
  employment_type?: "full_time" | "part_time";
  include_in_receiving_kpi?: boolean;
};
export type EmployeeUpdate = Partial<EmployeeInsert>;

// ─── Horaires (versionnés) ────────────────────────────────────────────────────

export interface EmployeeWorkSchedule {
  id: string;
  employee_id: string;
  weekday: number;          // 1=lundi ... 5=vendredi
  am_start: string | null;  // "HH:mm:ss"
  am_end: string | null;
  pm_start: string | null;
  pm_end: string | null;
  effective_from: string;   // "YYYY-MM-DD" — date à partir de laquelle cet horaire s'applique
  effective_to: string | null; // "YYYY-MM-DD" — null = actif
  created_at: string;
  updated_at: string;
}

export type EmployeeWorkScheduleInsert = Omit<EmployeeWorkSchedule, "id" | "created_at" | "updated_at"> & {
  effective_from?: string;
  effective_to?: string | null;
};
export type EmployeeWorkScheduleUpdate = Partial<EmployeeWorkScheduleInsert>;

// ─── Événements de capacité (table unifiée) ───────────────────────────────────

/** Types positifs : ajoutent des heures disponibles */
export type PositiveEventType = "overtime" | "part_time_boost";

/** Types négatifs intersectés avec l'horaire (journée ou portion) */
export type AbsenceEventType = "planned_absence" | "unplanned_absence";

/** Types négatifs durée brute (retards/départs) */
export type TimingEventType = "late" | "early_departure";

export type CapacityEventType = PositiveEventType | AbsenceEventType | TimingEventType;

export const CAPACITY_EVENT_LABELS: Record<CapacityEventType, string> = {
  overtime:           "Overtime",
  part_time_boost:    "Plage temps partiel",
  late:               "Retard",
  early_departure:    "Départ hâtif",
  planned_absence:    "Absence planifiée",
  unplanned_absence:  "Absence imprévue",
};

export const CAPACITY_EVENT_POSITIVE_TYPES: CapacityEventType[] = ["overtime", "part_time_boost"];
export const CAPACITY_EVENT_ABSENCE_TYPES: CapacityEventType[]  = ["planned_absence", "unplanned_absence"];
export const CAPACITY_EVENT_TIMING_TYPES: CapacityEventType[]   = ["late", "early_departure"];
export const CAPACITY_EVENT_NEGATIVE_TYPES: CapacityEventType[] = [...CAPACITY_EVENT_ABSENCE_TYPES, ...CAPACITY_EVENT_TIMING_TYPES];

/** Motifs d'absence (banques Nethris) — mots affichés au superviseur */
export type NethrisAbsenceReasonId =
  | "flex"
  | "unpaid"
  | "vacation"
  | "bank_reg"
  | "bank_ot"
  | "initiative";

export interface NethrisAbsenceReason {
  id: NethrisAbsenceReasonId;
  supervisor_label: string;
  nethris_label: string | null;
  event_type: AbsenceEventType;
  sort_order: number;
  active: boolean;
}

export interface CapacityEvent {
  id: string;
  employee_id: string;
  event_type: CapacityEventType;
  start_datetime: string;  // ISO
  end_datetime: string;    // ISO
  notes: string | null;
  nethris_reason_id: NethrisAbsenceReasonId | null;
  created_at: string;
}

export type CapacityEventInsert = Omit<CapacityEvent, "id" | "created_at">;
export type CapacityEventUpdate = Partial<CapacityEventInsert>;

export interface CapacityEventWithEmployee extends CapacityEvent {
  employees: Pick<Employee, "id" | "full_name">;
}

// ─── Congés prolongés ────────────────────────────────────────────────────────

export interface EmployeeLeave {
  id: string;
  employee_id: string;
  start_date: string;        // "YYYY-MM-DD"
  end_date: string | null;   // null = en cours
  reason: "medical" | "injury" | "mental" | "personal" | "other";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeLeaveInsert = Omit<EmployeeLeave, "id" | "created_at" | "updated_at">;
export type EmployeeLeaveUpdate = Partial<EmployeeLeaveInsert>;

// ─── Calcul de capacité ───────────────────────────────────────────────────────

export interface DayCapacity {
  employee: Employee;
  date: string; // "YYYY-MM-DD"
  scheduledHours: number;
  /** Heures perdues par absences (intersectées avec l'horaire planifié) */
  absenceHours: number;
  /** Heures perdues par retards/départs hâtifs (durée brute) */
  timingLossHours: number;
  /** Heures gagnées (overtime + part_time_boost) */
  positiveEventHours: number;
  /** Total heures perdues = absenceHours + timingLossHours */
  totalNegativeHours: number;
  /** Heures disponibles nettes */
  availableHours: number;
  /** Différence positive vs horaire planifié */
  overtime: number;
  /** Tous les événements de ce jour pour cet employé */
  events: CapacityEvent[];
}

export interface WeekSummary {
  date: string;
  totalScheduledHours: number;
  totalAbsenceHours: number;
  totalPositiveEventHours: number;
  totalAvailableHours: number;
  employeesWithTime: number;
  employeesAbsent: number;
}

// ─── Seuils de sous-effectif ─────────────────────────────────────────────────

export interface CapacityThreshold {
  weekday: number;       // 1=lundi … 5=vendredi
  min_employees: number;
  created_at: string;
  updated_at: string;
}

export type CapacityThresholdUpdate = Pick<CapacityThreshold, "min_employees">;

// ─── Types legacy (conservés pour compatibilité) ─────────────────────────────

export interface ExclusionType {
  id: string;
  code: string;
  label: string;
  color: string | null;
  is_active: boolean;
  created_at: string;
}

export type ExclusionTypeInsert = Omit<ExclusionType, "id" | "created_at">;
export type ExclusionTypeUpdate = Partial<ExclusionTypeInsert>;

export interface EmployeeExclusion {
  id: string;
  employee_id: string;
  exclusion_type_id: string;
  start_datetime: string;
  end_datetime: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeExclusionInsert = Omit<EmployeeExclusion, "id" | "created_at" | "updated_at">;
export type EmployeeExclusionUpdate = Partial<EmployeeExclusionInsert>;

export interface EmployeeAdjustment {
  id: string;
  employee_id: string;
  start_datetime: string;
  end_datetime: string;
  direction: "positive" | "negative";
  kind: "overtime" | "recovery";
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeAdjustmentInsert = Omit<EmployeeAdjustment, "id" | "created_at" | "updated_at" | "kind"> & {
  kind?: "overtime" | "recovery";
};
export type EmployeeAdjustmentUpdate = Partial<EmployeeAdjustmentInsert>;

export interface EmployeeExclusionWithType extends EmployeeExclusion {
  exclusion_types: ExclusionType;
  employees: Pick<Employee, "id" | "full_name">;
}

export interface EmployeeAdjustmentWithEmployee extends EmployeeAdjustment {
  employees: Pick<Employee, "id" | "full_name">;
}

export interface EmployeeWorkScheduleWithEmployee extends EmployeeWorkSchedule {
  employees: Pick<Employee, "id" | "full_name">;
}
