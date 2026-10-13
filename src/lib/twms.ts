// ── Types TWMS — copiés ici depuis l'ancien projet ────────────────────────────
// Dans TCAP, ce fichier remplace l'ancien app/types.ts

export interface DailyRecord {
  emp_key: string;
  prenom: string;
  nom: string;
  date: string;
  weekday: number;
  week: number;
  year: number;
  week_label: string;
  shift_start: string;
  shift_end: string;
  net_expected_min: number;
  first_log: string;
  last_log: string;
  work_logged_min: number;
  pause_logged_min: number;
  coverage_pct: number;
  total_gaps_min: number;
  gap_count: number;
  late_arrival_min: number;
  early_dep_min: number;
  before_shift_min: number;
  after_shift_min: number;
  dinner_worked_min: number;
  error_count: number;
  n_activities: number;
  gaps: GapInfo[];
  pauses: Record<string, PauseInfo>;
}

export interface GapInfo {
  from_dt: string;
  to_dt: string;
  gap_min: number;
  from_act: string;
  to_act: string;
}

export interface PauseInfo {
  min: number | null;
  flag: "OK" | "Absente" | "Trop courte" | "Trop longue" | "N/A";
  label: string;
}

export interface WeeklyRecord {
  emp_key: string;
  prenom: string;
  nom: string;
  week_label: string;
  week: number;
  year: number;
  days: number;
  work_min: number;
  work_hrs: number;
  overtime_min: number;
  overtime_hrs: number;
  gap_min: number;
  gap_n: number;
  err_n: number;
  cov_avg: number;
  hors_quart_min: number;
  din_w: number;
  late_n: number;
  early_n: number;
}

export interface AnomalyRecord {
  emp_key: string;
  prenom: string;
  nom: string;
  date: string;
  time?: string;   // HH:MM — heure de l'événement
  type: string;
  severity: "Élevée" | "Moyenne" | "Faible" | "Info";
  description: string;
  duration_min: number;
}

export interface AbsenceRecord {
  emp_key: string;
  prenom: string;
  nom: string;
  date: string;
  weekday: number;
  weekday_name: string;
  week: number;
  week_label: string;
  absence_type?: string;
}

export interface AllocationRecord {
  "Nom de l'activité": string;
  week_label: string;
  total_min: number;
  total_hrs: number;
}

export interface ComparisonDay {
  emp_key:            string;
  date:               string;
  nethris_hrs:        number;
  productive_min:     number;
  non_prod_min:       number;
  pause_paid_min:     number;
  lunch_min:          number;
  abnormal_min:       number;
  unknown_min:        number;
  total_logged_min:   number;
  twms_billed_min:    number;
  gap_vs_nethris_min: number;
  occupation_rate:    number;
  non_conforme_min:   number;
  activities: { name: string; category: string; label: string; dur_min: number; start: string }[];
}

export interface EmpPlannedSummary {
  emp_key:       string;
  working_days:  number;
  planned_hrs:   number;
  nethris_hrs:   number;
  nethris_days:  number;
  gap_hrs:       number;
  approved_days: number;
  sick_days:     number;
}

export interface AnalysisResult {
  daily: DailyRecord[];
  weekly: WeeklyRecord[];
  anomalies: AnomalyRecord[];
  absences: AbsenceRecord[];
  allocation: AllocationRecord[];
  ft_emps: string[];
  suivi_emps: string[];      // employés en suivi temporaire (logs visibles, exclus des KPIs)
  all_twms_emps: string[];   // tous les employés vus dans le CSV TWMS
  period: string;
  comparison:        ComparisonDay[]      | null;
  planned_summaries: EmpPlannedSummary[]  | null;
}

export function fmtMin(m: number | null | undefined): string {
  if (m == null || m === 0) return "0h 00m";
  const h = Math.floor(m / 60);
  const mn = Math.floor(m % 60);
  return `${h}h ${mn.toString().padStart(2, "0")}m`;
}

export function covColor(pct: number): string {
  if (pct >= 90) return "#22c55e";
  if (pct >= 75) return "#f59e0b";
  return "#ef4444";
}

export function sevColor(sev: string): string {
  if (sev === "Élevée") return "#ef4444";
  if (sev === "Moyenne") return "#f59e0b";
  if (sev === "Faible") return "#94a3b8";
  return "#60a5fa";
}
