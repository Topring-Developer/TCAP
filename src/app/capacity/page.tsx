"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { addWeeks, subWeeks, getISODay, format, addDays } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  EmployeeWorkSchedule,
  EmployeeExclusionWithType,
  EmployeeAdjustment,
  DayCapacity,
  WeekSummary,
} from "@/lib/supabase/types";
import {
  computeDayCapacity,
  getCellStatus,
  STATUS_COLORS,
  STATUS_DOT_COLORS,
  formatHours,
} from "@/lib/capacity";
import { getWeekStart, getWeekDays, DAY_LABELS, DAY_LABELS_FULL, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export default function CapacityPage() {
  const supabase = createClient();
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<EmployeeWorkSchedule[]>([]);
  const [exclusions, setExclusions] = useState<EmployeeExclusionWithType[]>([]);
  const [adjustments, setAdjustments] = useState<EmployeeAdjustment[]>([]);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ empId: string; dateStr: string } | null>(null);

  const weekDays = getWeekDays(weekStart);
  const weekStartStr = formatDate(weekStart);
  const weekEndStr = formatDate(weekDays[6]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = weekDays[0].toISOString();
    const end = addDays(weekDays[6], 1).toISOString();

    const [{ data: emps }, { data: scheds }, { data: excs }, { data: adjs }, { data: hols }] = await Promise.all([
      // Inclure les employés actifs ET ceux désactivés APRÈS le début de la semaine consultée
      // → les semaines passées restent visibles dans l'historique
      supabase.from("employees").select("*")
        .or(`is_active.eq.true,deactivated_at.gte.${start}`)
        .order("full_name"),
      supabase.from("employee_work_schedule").select("*"),
      supabase
        .from("employee_exclusions")
        .select("*, exclusion_types(*), employees(id, full_name)")
        .lt("start_datetime", end)
        .gt("end_datetime", start),
      supabase
        .from("employee_adjustments")
        .select("*, employees(id, full_name)")
        .lt("start_datetime", end)
        .gt("end_datetime", start),
      supabase
        .from("public_holidays")
        .select("date, label")
        .gte("date", formatDate(weekDays[0]))
        .lte("date", formatDate(weekDays[6])),
    ]);

    setEmployees(emps ?? []);
    setSchedules(scheds ?? []);
    setExclusions((excs as EmployeeExclusionWithType[]) ?? []);
    setAdjustments((adjs as EmployeeAdjustment[]) ?? []);
    // Construire un dictionnaire date → label
    const holMap: Record<string, string> = {};
    for (const h of (hols ?? [])) holMap[h.date] = h.label;
    setHolidays(holMap);
    setLoading(false);
  }, [weekStartStr]);

  useEffect(() => { load(); }, [load]);

  // Calcule toutes les capacités
  function getCapacity(emp: Employee, dateStr: string): DayCapacity {
    const isoDay = getISODay(new Date(dateStr + "T00:00:00"));
    const scheduleDay = isoDay <= 5 ? isoDay : null;
    const schedule = scheduleDay
      ? schedules.find((s) => s.employee_id === emp.id && s.weekday === scheduleDay)
      : undefined;
    const empExclusions = exclusions.filter((e) => e.employee_id === emp.id);
    const empAdjustments = adjustments.filter((a) => a.employee_id === emp.id);
    return computeDayCapacity(emp, dateStr, schedule, empExclusions, empAdjustments);
  }

  // Résumés par colonne
  function getDaySummary(dateStr: string): WeekSummary {
    const caps = employees.map((emp) => getCapacity(emp, dateStr));
    return {
      date: dateStr,
      totalScheduledHours: caps.reduce((s, c) => s + c.scheduledHours, 0),
      totalExclusionHours: caps.reduce((s, c) => s + c.exclusionHours, 0),
      totalPositiveAdjustmentHours: caps.reduce((s, c) => s + c.positiveAdjustmentHours, 0),
      totalNegativeAdjustmentHours: caps.reduce((s, c) => s + c.negativeAdjustmentHours, 0),
      totalAvailableHours: caps.reduce((s, c) => s + c.availableHours, 0),
      employeesWithTime: caps.filter((c) => c.scheduledHours > 0 || c.adjustments.length > 0).length,
      employeesAbsent: caps.filter(
        (c) => c.scheduledHours > 0 && (c.exclusionHours > 0 || c.negativeAdjustmentHours > 0)
      ).length,
    };
  }

  const today = formatDate(new Date());

  return (
    <div className="p-6 flex flex-col h-full">
      {/* En-tête de navigation semaine */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Vue semaine — Capacité</h1>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">
            {format(weekDays[0], "d MMM", { locale: fr })} – {format(weekDays[6], "d MMM yyyy", { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(getWeekStart(new Date()))}>
            <Calendar className="w-3.5 h-3.5" /> Aujourd&apos;hui
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => subWeeks(w, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">Chargement…</div>
      ) : employees.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          Aucun employé actif — ajoutez des employés d&apos;abord.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white flex-1">
          <table className="w-full text-sm border-collapse">
            <thead>
              {/* Ligne 1 : jours */}
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-4 py-3 text-left w-44">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Employé</span>
                </th>
                {weekDays.map((day, i) => {
                  const dateStr = formatDate(day);
                  const isToday = dateStr === today;
                  const isWeekend = i >= 5;
                  const holidayLabel = holidays[dateStr];
                  return (
                    <th
                      key={dateStr}
                      className={cn(
                        "px-3 py-3 text-center border-r border-slate-100 min-w-[130px]",
                        isWeekend ? "bg-slate-50" : "bg-white",
                        isToday && "bg-blue-50",
                        holidayLabel && "bg-amber-50"
                      )}
                    >
                      <div className={cn(
                        "font-semibold text-sm",
                        isToday ? "text-blue-700" : isWeekend ? "text-slate-400" : "text-slate-700",
                        holidayLabel && "text-amber-700"
                      )}>
                        {DAY_LABELS_FULL[i]}
                      </div>
                      <div className={cn(
                        "text-xs mt-0.5",
                        isToday ? "text-blue-500" : "text-slate-400",
                        holidayLabel && "text-amber-500"
                      )}>
                        {format(day, "d MMM", { locale: fr })}
                      </div>
                      {holidayLabel && (
                        <div className="text-xs mt-0.5 text-amber-600 font-medium truncate max-w-[120px] mx-auto">
                          🏖 {holidayLabel}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>

              {/* Ligne 2 : résumé par jour */}
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-4 py-2 text-left">
                  <span className="text-xs text-slate-400 font-normal">Résumé équipe</span>
                </th>
                {weekDays.map((day, i) => {
                  const dateStr = formatDate(day);
                  const isWeekend = i >= 5;
                  const summary = getDaySummary(dateStr);
                  return (
                    <td
                      key={dateStr}
                      className={cn(
                        "px-3 py-2 text-center border-r border-slate-100",
                        isWeekend ? "bg-slate-50" : "bg-slate-50"
                      )}
                    >
                      {!isWeekend || summary.totalAvailableHours > 0 ? (
                        <div className="space-y-0.5">
                          <div className="text-base font-bold text-slate-900">
                            {formatHours(summary.totalAvailableHours)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {summary.employeesWithTime} en poste
                            {summary.employeesAbsent > 0 && (
                              <span className="text-orange-500 ml-1">· {summary.employeesAbsent} abs.</span>
                            )}
                          </div>
                          {summary.totalExclusionHours > 0 && (
                            <div className="text-xs text-red-400">
                              −{formatHours(summary.totalExclusionHours)} abs.
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors group">
                  {/* Nom */}
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/50 border-r border-slate-200 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
                        {emp.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-slate-900 text-sm truncate max-w-[100px]">
                        {emp.full_name}
                      </span>
                    </div>
                  </td>

                  {/* Cellules par jour */}
                  {weekDays.map((day, i) => {
                    const dateStr = formatDate(day);
                    const isWeekend = i >= 5;
                    const cap = getCapacity(emp, dateStr);
                    const status = getCellStatus(cap, isWeekend);
                    const isActive = tooltip?.empId === emp.id && tooltip?.dateStr === dateStr;

                    return (
                      <td
                        key={dateStr}
                        className={cn(
                          "px-3 py-2 border-r border-slate-100 relative cursor-pointer",
                          "transition-all"
                        )}
                        onClick={() =>
                          setTooltip(isActive ? null : { empId: emp.id, dateStr })
                        }
                      >
                        <div className={cn(
                          "rounded-lg border p-2 text-center min-h-[64px] flex flex-col justify-center gap-1",
                          STATUS_COLORS[status]
                        )}>
                          {status === "empty" ? (
                            <span className="text-xs text-slate-300">—</span>
                          ) : (
                            <>
                              {/* Dot + heures nettes */}
                              <div className="flex items-center justify-center gap-1.5">
                                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", STATUS_DOT_COLORS[status])} />
                                <span className="text-base font-bold">
                                  {formatHours(cap.availableHours)}
                                </span>
                              </div>
                              {/* Détail discret */}
                              <div className="text-xs opacity-70 leading-tight">
                                {[
                                  cap.scheduledHours > 0 && `${formatHours(cap.scheduledHours)} base`,
                                  cap.exclusionHours > 0 && `−${formatHours(cap.exclusionHours)} abs`,
                                  cap.positiveAdjustmentHours > 0 && `+${formatHours(cap.positiveAdjustmentHours)} adj`,
                                  cap.negativeAdjustmentHours > 0 && `−${formatHours(cap.negativeAdjustmentHours)} adj`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Tooltip détaillé */}
                        {isActive && (
                          <CellTooltip cap={cap} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Légende */}
      <div className="flex items-center gap-5 mt-4 flex-wrap">
        <span className="text-xs text-slate-400 font-medium">Légende :</span>
        {[
          { status: "normal" as const, label: "Normal" },
          { status: "adjusted" as const, label: "Ajusté partiellement" },
          { status: "absent" as const, label: "Absent complet" },
          { status: "overtime" as const, label: "Overtime net" },
          { status: "empty" as const, label: "Aucun horaire" },
        ].map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={cn("w-3 h-3 rounded-sm border", STATUS_COLORS[status])} />
            <span className="text-xs text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CellTooltip({ cap }: { cap: DayCapacity }) {
  return (
    <div className="absolute z-30 left-0 top-full mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-4 text-left pointer-events-none">
      <p className="font-semibold text-sm text-slate-900 mb-3">{cap.employee.full_name}</p>
      <div className="space-y-1.5 text-xs text-slate-600">
        <Row label="Base planifiée" value={formatHours(cap.scheduledHours)} />
        {cap.exclusionHours > 0 && (
          <Row label="Exclusions" value={`−${formatHours(cap.exclusionHours)}`} className="text-red-600" />
        )}
        {cap.positiveAdjustmentHours > 0 && (
          <Row label="Ajust. positifs" value={`+${formatHours(cap.positiveAdjustmentHours)}`} className="text-blue-600" />
        )}
        {cap.negativeAdjustmentHours > 0 && (
          <Row label="Ajust. négatifs" value={`−${formatHours(cap.negativeAdjustmentHours)}`} className="text-orange-600" />
        )}
        <div className="border-t border-slate-100 pt-1.5 mt-1.5">
          <Row label="Disponible" value={formatHours(cap.availableHours)} className="font-semibold text-slate-900" />
          {cap.overtime !== 0 && (
            <Row
              label="Overtime"
              value={`${cap.overtime > 0 ? "+" : ""}${formatHours(cap.overtime)}`}
              className={cap.overtime > 0 ? "text-blue-600" : "text-orange-600"}
            />
          )}
        </div>

        {cap.exclusions.length > 0 && (
          <div className="border-t border-slate-100 pt-1.5 mt-1.5">
            <p className="text-slate-400 mb-1 font-medium">Exclusions</p>
            {cap.exclusions.map((ex) => (
              <p key={ex.id} className="truncate">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1"
                  style={{ backgroundColor: ex.exclusion_types?.color ?? "#94a3b8" }}
                />
                {ex.exclusion_types?.label}
                {ex.notes && ` — ${ex.notes}`}
              </p>
            ))}
          </div>
        )}

        {cap.adjustments.length > 0 && (
          <div className="border-t border-slate-100 pt-1.5 mt-1.5">
            <p className="text-slate-400 mb-1 font-medium">Ajustements</p>
            {cap.adjustments.map((adj) => (
              <p key={adj.id} className="truncate">
                <span className={adj.direction === "positive" ? "text-blue-600" : "text-orange-600"}>
                  {adj.direction === "positive" ? "+" : "−"}
                </span>{" "}
                {adj.notes ?? adj.direction}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cn("font-medium", className)}>{value}</span>
    </div>
  );
}
