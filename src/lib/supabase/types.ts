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
  created_at: string;
  updated_at: string;
}

export type EmployeeInsert = Omit<Employee, "id" | "created_at" | "updated_at">;
export type EmployeeUpdate = Partial<EmployeeInsert>;

export interface EmployeeWorkSchedule {
  id: string;
  employee_id: string;
  weekday: number; // 1=lundi ... 5=vendredi
  am_start: string | null; // "HH:mm:ss"
  am_end: string | null;
  pm_start: string | null;
  pm_end: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeWorkScheduleInsert = Omit<EmployeeWorkSchedule, "id" | "created_at" | "updated_at">;
export type EmployeeWorkScheduleUpdate = Partial<EmployeeWorkScheduleInsert>;

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
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeAdjustmentInsert = Omit<EmployeeAdjustment, "id" | "created_at" | "updated_at">;
export type EmployeeAdjustmentUpdate = Partial<EmployeeAdjustmentInsert>;

// ─── Joined types (avec relations) ───────────────────────────────────────────

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

// ─── Calcul de capacité ───────────────────────────────────────────────────────

export interface DayCapacity {
  employee: Employee;
  date: string; // "YYYY-MM-DD"
  scheduledHours: number;
  exclusionHours: number;
  positiveAdjustmentHours: number;
  negativeAdjustmentHours: number;
  availableHours: number;
  overtime: number;
  exclusions: EmployeeExclusionWithType[];
  adjustments: EmployeeAdjustment[];
}

export interface WeekSummary {
  date: string;
  totalScheduledHours: number;
  totalExclusionHours: number;
  totalPositiveAdjustmentHours: number;
  totalNegativeAdjustmentHours: number;
  totalAvailableHours: number;
  employeesWithTime: number;
  employeesAbsent: number;
}
