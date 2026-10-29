"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Calendar, Plus, Trash2, Save,
  UserX, UserCheck, CalendarPlus,
} from "lucide-react";
import { addWeeks, subWeeks, getISODay, format, addDays, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  EmployeeWorkSchedule,
  CapacityEvent,
  CapacityEventInsert,
  CapacityEventType,
  EmployeeLeave,
  EmployeeLeaveInsert,
  DayCapacity,
  CapacityThreshold,
  NethrisAbsenceReasonId,
} from "@/lib/supabase/types";
import { CAPACITY_EVENT_LABELS, CAPACITY_EVENT_POSITIVE_TYPES, CAPACITY_EVENT_NEGATIVE_TYPES } from "@/lib/supabase/types";
import {
  computeDayCapacity,
  formatHours,
  getAttendanceStatus,
  getDominantEvent,
  sortEmployeesByPresence,
  getActiveLeave,
  getScheduleForDate,
  LEAVE_REASON_LABELS,
  NETHRIS_ABSENCE_REASONS,
  getEventDisplayLabel,
} from "@/lib/capacity";
import { getWeekStart, getWeekDays, DAY_LABELS_FULL, formatDate, WEEKDAY_LABELS } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type DaySchedule = { am_start: string; am_end: string; pm_start: string; pm_end: string };
type ScheduleMap = Record<number, DaySchedule>;
const DEFAULT_DAY: DaySchedule = { am_start: "", am_end: "", pm_start: "", pm_end: "" };

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Formate une heure Date → "7h30" */
function formatTimeShort(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Plage d'un événement pour le jour (ex. "7h30 – 12h") */
function formatEventRange(ev: CapacityEvent, dateStr: string): string {
  const dayStart = new Date(dateStr + "T00:00:00");
  const dayEnd   = new Date(dateStr + "T23:59:59");
  const evStart  = parseISO(ev.start_datetime);
  const evEnd    = parseISO(ev.end_datetime);
  const start = evStart < dayStart ? dayStart : evStart;
  const end   = evEnd   > dayEnd   ? dayEnd   : evEnd;
  if (start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() >= 23) return "Journée complète";
  return `${formatTimeShort(start)} – ${formatTimeShort(end)}`;
}

// ─── Sélecteur de semaine (texte libre + picker natif) ───────────────────────

function DateJumper({ weekStart, onJump }: { weekStart: Date; onJump: (d: Date) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const displayStr = format(weekStart, "dd/MM/yyyy", { locale: fr });
  const [text, setText] = useState(displayStr);
  const [focused, setFocused] = useState(false);

  React.useEffect(() => {
    if (!focused) setText(format(weekStart, "dd/MM/yyyy", { locale: fr }));
  }, [weekStart, focused]);

  function tryParse(raw: string): Date | null {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      return isNaN(d.getTime()) ? null : d;
    }
    const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
      const [, dd, mm, yy] = m;
      const year = yy.length === 2 ? 2000 + parseInt(yy) : parseInt(yy);
      const d = new Date(year, parseInt(mm) - 1, parseInt(dd));
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function commit(raw: string) {
    const parsed = tryParse(raw);
    if (parsed) onJump(getWeekStart(parsed));
    else setText(format(weekStart, "dd/MM/yyyy", { locale: fr }));
    setFocused(false);
  }

  return (
    <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:border-slate-400 transition-colors">
      <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder="jj/mm/aaaa"
        onFocus={() => { setFocused(true); setTimeout(() => inputRef.current?.select(), 0); }}
        onBlur={(e) => commit(e.target.value)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(text); inputRef.current?.blur(); }
          if (e.key === "Escape") { setText(displayStr); setFocused(false); inputRef.current?.blur(); }
        }}
        className="text-sm text-slate-700 bg-transparent border-0 outline-none focus:ring-0 w-24"
        title="Taper une date (jj/mm/aaaa) et Entrée pour sauter à cette semaine"
      />
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function CapacityPage() {
  const supabase = createClient();

  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<EmployeeWorkSchedule[]>([]);
  const [events, setEvents] = useState<CapacityEvent[]>([]);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState<Record<number, number>>({});
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaturday, setShowSaturday] = useState(false);

  // Modals
  const [eventModal, setEventModal] = useState<{
    open: boolean;
    employee: Employee | null;
    dateStr: string;
    existingEvent: CapacityEvent | null;
    mode: "absence" | "overtime";
  }>({ open: false, employee: null, dateStr: "", existingEvent: null, mode: "absence" });

  const [empModal, setEmpModal] = useState<{
    open: boolean;
    employee: Employee | null;
    tab: "schedule" | "profile" | "leave";
  }>({ open: false, employee: null, tab: "schedule" });

  const [weeklyModal, setWeeklyModal] = useState<{
    open: boolean;
    employee: Employee | null;
    weekStart: Date;
  }>({ open: false, employee: null, weekStart: new Date() });

  const weekDays = getWeekDays(weekStart);
  const visibleDays = weekDays.slice(0, showSaturday ? 6 : 5);
  const weekStartStr = formatDate(weekStart);
  const weekEndStr   = formatDate(weekDays[6]);
  const today        = formatDate(new Date());

  // ─── Chargement ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const start = weekDays[0].toISOString();
    const end   = addDays(weekDays[6], 1).toISOString();

    const [
      { data: emps },
      { data: scheds },
      { data: evs },
      { data: hols },
      { data: thresh },
      { data: lvs },
    ] = await Promise.all([
      supabase.from("employees").select("*")
        .or(`is_active.eq.true,deactivated_at.gte.${start}`)
        .order("full_name"),
      supabase.from("employee_work_schedule").select("*"),
      supabase.from("capacity_events")
        .select("*")
        .lt("start_datetime", end)
        .gt("end_datetime", start),
      supabase.from("public_holidays").select("date, label")
        .gte("date", weekStartStr).lte("date", weekEndStr),
      supabase.from("capacity_thresholds").select("*"),
      supabase.from("employee_leaves").select("*")
        .or(`end_date.is.null,end_date.gte.${weekStartStr}`),
    ]);

    setEmployees(emps ?? []);
    setSchedules(scheds ?? []);
    setEvents((evs as CapacityEvent[]) ?? []);
    setLeaves((lvs as EmployeeLeave[]) ?? []);

    const holMap: Record<string, string> = {};
    for (const h of (hols ?? [])) holMap[h.date] = h.label;
    setHolidays(holMap);

    const thMap: Record<number, number> = {};
    for (const t of ((thresh as CapacityThreshold[]) ?? [])) thMap[t.weekday] = t.min_employees;
    setThresholds(thMap);

    setLoading(false);
  }, [weekStartStr]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // ─── Calculs grille ───────────────────────────────────────────────────────

  function getCapacity(emp: Employee, dateStr: string): DayCapacity {
    const isoDay     = getISODay(new Date(dateStr + "T00:00:00"));
    const scheduleDay = isoDay <= 5 ? isoDay : null;
    const schedule   = scheduleDay
      ? getScheduleForDate(schedules, emp.id, dateStr, scheduleDay)
      : undefined;
    const empEvents = events.filter((e) => e.employee_id === emp.id);
    return computeDayCapacity(emp, dateStr, schedule, empEvents);
  }

  function getDaySummary(dateStr: string, dayIndex: number) {
    const weekday   = dayIndex + 1;
    const threshold = thresholds[weekday] ?? 0;
    const isHoliday = !!holidays[dateStr];

    if (isHoliday) return { present: 0, absent: 0, underStaffed: false, threshold, absentList: [], isHoliday: true };

    // Employés actifs ce jour (en congé prolongé exclus)
    const activeEmps = sortedEmployees; // déjà filtrés
    const caps = activeEmps.map((emp) => getCapacity(emp, dateStr));

    const present = caps.filter(
      (c) => c.scheduledHours > 0 && c.totalNegativeHours === 0 && c.availableHours > 0
    ).length;

    const absentCaps = caps.filter(
      (c) => c.scheduledHours > 0 && (c.totalNegativeHours > 0 || c.availableHours <= 0)
    );
    const absent     = absentCaps.length;
    const underStaffed = threshold > 0 && present < threshold;

    const absentList = absentCaps.map((c) => {
      const dominant  = getDominantEvent(c);
      const isPartial = c.availableHours > 0 && c.totalNegativeHours > 0;
      return {
        name: c.employee.full_name,
        event: dominant,
        detail: dominant
          ? isPartial ? formatEventRange(dominant, dateStr) : "Journée complète"
          : "Absent",
      };
    });

    return { present, absent, underStaffed, threshold, absentList, isHoliday: false };
  }

  // Employés filtrés (on_leave masqués) et triés
  const sortedEmployees = sortEmployeesByPresence(
    employees, schedules, events, leaves, weekStartStr, weekEndStr
  );

  // ─── Interactions ─────────────────────────────────────────────────────────

  function openEventModal(emp: Employee, dateStr: string, cap: DayCapacity, mode: "absence" | "overtime") {
    const negEvent = cap.events.find((e) => CAPACITY_EVENT_NEGATIVE_TYPES.includes(e.event_type)) ?? null;
    const posEvent = cap.events.find((e) => CAPACITY_EVENT_POSITIVE_TYPES.includes(e.event_type)) ?? null;
    setEventModal({
      open: true,
      employee: emp,
      dateStr,
      existingEvent: mode === "absence" ? negEvent : posEvent,
      mode,
    });
  }

  function openEmployeeModal(emp: Employee) {
    setEmpModal({ open: true, employee: emp, tab: "schedule" });
  }

  // ─── Rendu grille ─────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      {/* En-tête navigation */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0 gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Calendrier de présence</h1>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">
            {format(weekDays[0], "d MMM", { locale: fr })} – {format(weekDays[6], "d MMM yyyy", { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateJumper weekStart={weekStart} onJump={setWeekStart} />
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(getWeekStart(new Date()))}>
            Aujourd&apos;hui
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
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white flex-1">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-4 py-3 text-left w-44">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {sortedEmployees.length} employés
                  </span>
                </th>

                {visibleDays.map((day, i) => {
                  const dateStr    = formatDate(day);
                  const isToday    = dateStr === today;
                  const isPast     = dateStr < today;
                  const isSaturday = i === 5;
                  const holidayLabel = holidays[dateStr];
                  const summary    = !isSaturday ? getDaySummary(dateStr, i) : null;

                  return (
                    <th
                      key={dateStr}
                      className={cn(
                        "px-2 py-3 text-center border-r border-slate-100 min-w-[150px] align-top",
                        isPast && !isToday && "grayscale",
                        isToday && "bg-slate-800",
                        isSaturday && !isPast && !isToday && "bg-slate-50 border-l border-l-slate-200",
                        summary?.underStaffed && !isPast && !isToday && "bg-red-50/60"
                      )}
                    >
                      <div className="px-2 py-2">
                        <div className={cn(
                          "text-xs uppercase tracking-widest font-semibold mb-0.5",
                          isToday ? "text-slate-300" : isPast ? "text-slate-300" : "text-slate-400"
                        )}>
                          {DAY_LABELS_FULL[i]}
                        </div>
                        <div className={cn(
                          "text-base font-bold",
                          isToday ? "text-white" : isPast ? "text-slate-400" : "text-slate-700"
                        )}>
                          {format(day, "d MMM", { locale: fr })}
                        </div>
                        {isToday && (
                          <div className="text-[10px] mt-0.5 font-bold uppercase tracking-widest text-slate-300">
                            Aujourd&apos;hui
                          </div>
                        )}
                        {isSaturday && (
                          <div className="text-[10px] mt-0.5 text-slate-500 font-semibold uppercase tracking-wide">
                            Overtime
                          </div>
                        )}
                        {holidayLabel && (
                          <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-[11px] font-semibold text-amber-700">
                            {holidayLabel}
                          </div>
                        )}
                        {summary && !summary.isHoliday && (
                          <div className="mt-2 space-y-0.5">
                            <div className="relative inline-block group/absent">
                              <div className="text-xs cursor-default select-none">
                                <span className={cn("font-bold", isToday ? "text-white" : "text-slate-800")}>
                                  {summary.present}
                                </span>
                                <span className={cn("mx-1", isToday ? "text-slate-500" : "text-slate-300")}>·</span>
                                {summary.absent > 0
                                  ? <span className={cn(
                                      "font-semibold underline decoration-dotted underline-offset-2 cursor-pointer",
                                      isToday ? "text-red-300" : "text-slate-600"
                                    )}>{summary.absent} abs</span>
                                  : <span className={cn(isToday ? "text-slate-400" : "text-slate-400")}>0 abs</span>
                                }
                              </div>

                              {summary.absent > 0 && (
                                <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 p-3 text-left pointer-events-none opacity-0 group-hover/absent:opacity-100 transition-opacity duration-150">
                                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Absents ce jour</p>
                                  <div className="space-y-1.5">
                                    {summary.absentList.map(({ name, event: ev, detail }) => (
                                      <div key={name} className="flex items-start gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0 mt-1.5" />
                                        <div className="min-w-0 flex-1">
                                          <p className="text-xs text-slate-800 truncate font-medium">{name}</p>
                                          <p className="text-[10px] text-slate-500">
                                            {ev ? getEventDisplayLabel(ev) : "Absent"}
                                            {" · "}{detail}
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {summary.underStaffed && (
                              <div className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                isToday ? "bg-red-500 text-white" : "bg-slate-800 text-white"
                              )}>
                                Sous-effectif
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {sortedEmployees.map((emp, empIdx) => {
                const prevEmp = sortedEmployees[empIdx - 1];
                const hasEventNow = events.some((e) => e.employee_id === emp.id);
                const prevHadEvent = prevEmp ? events.some((e) => e.employee_id === prevEmp.id) : true;
                const hasScheduleNow = schedules.some(
                  (s) => s.employee_id === emp.id && (s.am_start || s.pm_start) && s.effective_to === null
                );
                const prevHadSchedule = prevEmp
                  ? schedules.some((s) => s.employee_id === prevEmp.id && (s.am_start || s.pm_start) && s.effective_to === null)
                  : true;

                const showGroupDivider =
                  empIdx > 0 &&
                  ((!hasEventNow && prevHadEvent) ||
                    (!hasScheduleNow && !hasEventNow && (prevHadEvent || prevHadSchedule)));

                const groupLabel = !hasScheduleNow && !hasEventNow ? "Sans horaire" : "Présents";

                return (
                  <React.Fragment key={emp.id}>
                    {showGroupDivider && (
                      <tr>
                        <td className="sticky left-0 z-10 bg-white border-t border-slate-200 px-4 py-0.5">
                          <span className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">{groupLabel}</span>
                        </td>
                        {visibleDays.map((d) => {
                          const dStr = formatDate(d);
                          const isThisToday = dStr === today;
                          return (
                            <td key={dStr} className={cn(isThisToday ? "bg-slate-800 py-0.5" : "border-t border-slate-200 bg-white")} />
                          );
                        })}
                      </tr>
                    )}

                    <tr className="hover:bg-slate-50/40 transition-colors group">
                      <td
                        className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/40 border-r border-slate-200 px-4 py-2"
                        onClick={() => openEmployeeModal(emp)}
                      >
                        <div className="flex items-center gap-2 cursor-pointer">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
                            {emp.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-medium text-slate-900 text-sm truncate block max-w-[100px] hover:text-blue-600 hover:underline transition-colors">
                              {emp.full_name}
                            </span>
                            {!emp.is_active && (
                              <span className="text-[10px] text-slate-400">Inactif</span>
                            )}
                            {emp.is_active && emp.employment_type === "part_time" && (
                              <span
                                className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600"
                                onClick={(e) => { e.stopPropagation(); setWeeklyModal({ open: true, employee: emp, weekStart }); }}
                                title="Gérer la disponibilité hebdomadaire"
                              >
                                TP
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {visibleDays.map((day, i) => {
                        const dateStr    = formatDate(day);
                        const isSaturday = i === 5;
                        const isToday    = dateStr === today;
                        const isPast     = dateStr < today;
                        const isHoliday  = !!holidays[dateStr];
                        const activeLeave = getActiveLeave(emp.id, dateStr, leaves);
                        const cap        = getCapacity(emp, dateStr);
                        const status     = getAttendanceStatus(cap, isSaturday, !!activeLeave, isHoliday);
                        const dominant   = getDominantEvent(cap);

                        return (
                          <td
                            key={dateStr}
                            className={cn(
                              "px-2 py-2 border-r border-slate-100 transition-opacity",
                              isPast && !isToday && "grayscale bg-slate-50/30",
                              isSaturday && !isPast && "bg-slate-50/40 border-l border-l-slate-200",
                              isToday && "bg-slate-50 border-l-2 border-l-slate-700"
                            )}
                          >
                            <AttendanceCell
                              cap={cap}
                              status={status}
                              dominant={dominant}
                              isSaturday={isSaturday}
                              isPast={isPast}
                              activeLeave={activeLeave}
                              onClick={() => {
                                if (status === "on_leave" || status === "holiday") return;
                                // Cellule vide + employé temps partiel → modale disponibilité hebdo
                                if (status === "empty" && emp.employment_type === "part_time") {
                                  setWeeklyModal({ open: true, employee: emp, weekStart });
                                  return;
                                }
                                openEventModal(emp, dateStr, cap, isSaturday ? "overtime" : "absence");
                              }}
                              onOTClick={!isSaturday && !isPast && status !== "on_leave" && status !== "holiday"
                                ? () => openEventModal(emp, dateStr, cap, "overtime")
                                : undefined
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Légende */}
      <div className="flex items-center gap-5 mt-3 flex-wrap flex-shrink-0">
        <span className="text-xs text-slate-400 font-medium">Légende :</span>
        {[
          { cls: "bg-white border border-slate-200",                     dot: "bg-green-500", label: "Présent" },
          { cls: "bg-white border-2 border-slate-800",                   dot: "bg-red-500",   label: "Absent" },
          { cls: "bg-white border border-dashed border-slate-800",       dot: "bg-red-500",   label: "Partiel" },
          { cls: "bg-slate-100 border border-slate-200",                 dot: null,           label: "Vacances" },
          { cls: "bg-transparent border border-dashed border-slate-200", dot: null,           label: "Sans horaire" },
        ].map(({ cls, label, dot }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={cn("w-3 h-3 rounded-sm flex items-center justify-center", cls)}>
              {dot && <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />}
            </span>
            <span className="text-xs text-slate-500">{label}</span>
          </div>
        ))}

        <button
          onClick={() => setShowSaturday((v) => !v)}
          title={`Samedi ${format(weekDays[5], "d MMM", { locale: fr })} — overtime`}
          className={cn(
            "flex items-center gap-1.5 text-xs border rounded-md px-2 py-0.5 transition-colors",
            showSaturday
              ? "border-slate-400 bg-slate-100 text-slate-700"
              : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-500"
          )}
        >
          <CalendarPlus className="w-3 h-3" />
          <span>Sam. OT</span>
        </button>
      </div>

      {/* ─── Modal Événement (absence / overtime) ─────────────────────── */}
      {eventModal.open && eventModal.employee && (
        <CapacityEventModal
          employee={eventModal.employee}
          dateStr={eventModal.dateStr}
          defaultMode={eventModal.mode}
          existingEvent={eventModal.existingEvent}
          schedules={schedules.filter((s) => s.employee_id === eventModal.employee!.id)}
          weekDays={weekDays}
          onClose={() => setEventModal((s) => ({ ...s, open: false }))}
          onSaved={() => { setEventModal((s) => ({ ...s, open: false })); load(); }}
        />
      )}

      {/* ─── Modal Employé ─────────────────────────────────────────────── */}
      {empModal.open && empModal.employee && (
        <EmployeeModal
          employee={empModal.employee}
          tab={empModal.tab}
          schedules={schedules.filter((s) => s.employee_id === empModal.employee!.id)}
          allSchedules={schedules}
          leaves={leaves.filter((l) => l.employee_id === empModal.employee!.id)}
          onTabChange={(t) => setEmpModal((s) => ({ ...s, tab: t }))}
          onClose={() => setEmpModal((s) => ({ ...s, open: false }))}
          onSaved={() => { setEmpModal((s) => ({ ...s, open: false })); load(); }}
        />
      )}

      {/* ─── Modal Disponibilité hebdo (temps partiel) ──────────────────── */}
      {weeklyModal.open && weeklyModal.employee && (
        <WeeklyAvailabilityModal
          employee={weeklyModal.employee}
          initialWeekStart={weeklyModal.weekStart}
          allSchedules={schedules}
          onClose={() => setWeeklyModal((s) => ({ ...s, open: false }))}
          onSaved={() => { setWeeklyModal((s) => ({ ...s, open: false })); load(); }}
        />
      )}
    </div>
  );
}

// ─── Cellule de présence ──────────────────────────────────────────────────────

function AttendanceCell({
  cap,
  status,
  dominant,
  isSaturday,
  isPast,
  activeLeave,
  onClick,
  onOTClick,
}: {
  cap: DayCapacity;
  status: ReturnType<typeof getAttendanceStatus>;
  dominant: CapacityEvent | null;
  isSaturday?: boolean;
  isPast?: boolean;
  activeLeave?: EmployeeLeave | null;
  onClick: () => void;
  onOTClick?: () => void;
}) {
  // Congé prolongé — non affiché (l'employé est masqué de la grille, mais si on_leave on défend l'accès)
  if (status === "on_leave") {
    const reason = activeLeave ? (LEAVE_REASON_LABELS[activeLeave.reason] ?? "Congé") : "Congé";
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 min-h-[56px] flex flex-col items-center justify-center gap-0.5 p-2 select-none">
        <span className="text-xs font-semibold text-slate-400">{reason}</span>
        {activeLeave && (
          <span className="text-[10px] text-slate-300">
            {activeLeave.end_date ? `jusqu'au ${activeLeave.end_date}` : "en cours"}
          </span>
        )}
      </div>
    );
  }

  if (status === "holiday") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-100 min-h-[56px] flex items-center justify-center">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Férié</span>
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div
        onClick={onClick}
        className={cn(
          "rounded-lg border border-dashed border-slate-200 min-h-[56px] flex items-center justify-center transition-all cursor-pointer group/cell",
          !isPast && "hover:bg-slate-50 hover:border-slate-300"
        )}
      >
        <span className="text-slate-300 text-xs group-hover/cell:text-slate-400 flex items-center gap-1">
          <Plus className="w-3 h-3" />
          {isSaturday ? "Overtime" : "Absence"}
        </span>
      </div>
    );
  }

  if (status === "absent" || status === "partial") {
    const reason = dominant ? getEventDisplayLabel(dominant) : "Absent";
    const isVacation = dominant?.nethris_reason_id === "vacation"
      || (!dominant?.nethris_reason_id && dominant?.event_type === "planned_absence");
    const isPartial  = status === "partial";

    const rangeLabel = dominant
      ? (isPartial ? formatEventRange(dominant, cap.date) : "Journée complète")
      : `−${formatHours(cap.totalNegativeHours)}`;

    const notes = dominant?.notes ?? null;
    const tooltipLines: string[] = [];
    if (isPartial && rangeLabel && rangeLabel !== "Absent") tooltipLines.push(rangeLabel);
    if (notes) tooltipLines.push(notes);

    if (isVacation) {
      return (
        <div
          onClick={onClick}
          className={cn(
            "relative group/abs rounded-lg border border-slate-200 bg-slate-100 min-h-[56px] flex flex-col items-center justify-center gap-0.5 p-2 cursor-pointer transition-colors",
            !isPast && "hover:bg-slate-200/60"
          )}
        >
          <span className="text-xs font-medium text-slate-500 truncate max-w-full">{reason}</span>
          {notes && (
            <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-30 bg-slate-800 text-white text-[11px] px-2 py-1 rounded max-w-[180px] text-center leading-snug whitespace-normal opacity-0 group-hover/abs:opacity-100 transition-opacity">
              {notes}
            </div>
          )}
        </div>
      );
    }

    // Pastille : jaune=partiel, rouge=journée complète, gris=passé
    const dotColor = isPast ? "bg-slate-300" : isPartial ? "bg-yellow-400" : "bg-red-500";

    return (
      <div
        onClick={onClick}
        className={cn(
          "relative group/abs rounded-lg bg-white border-2 border-slate-800 min-h-[56px] flex flex-col items-center justify-center gap-0.5 p-2 cursor-pointer transition-colors",
          !isPast && "hover:bg-slate-50"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
          <span className="text-xs font-semibold text-slate-800 truncate max-w-[90px]">{reason}</span>
        </div>
        {cap.scheduledHours > 0 && (
          <span className="text-xs font-semibold text-slate-700">{formatHours(Math.max(0, cap.availableHours))}</span>
        )}
        {tooltipLines.length > 0 && (
          <div className="pointer-events-none absolute -top-1 translate-y-[-100%] left-1/2 -translate-x-1/2 z-30 bg-slate-800 text-white text-[11px] px-2 py-1.5 rounded max-w-[200px] text-center leading-snug whitespace-normal opacity-0 group-hover/abs:opacity-100 transition-opacity">
            {tooltipLines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    );
  }

  // Présent / overtime
  const hasPositiveEvents = cap.positiveEventHours > 0;
  const hasRecovery = cap.events.some((e) => e.event_type === "time_recovery");
  const hasPlage = cap.events.some((e) => e.event_type === "part_time_boost");
  const otLabel = hasRecovery ? "récup." : hasPlage ? "plage" : "OT";

  return (
    <div className="relative group/ot-wrap min-h-[56px]">
      <div
        onClick={onClick}
        className={cn(
          "rounded-lg border border-slate-200 bg-white min-h-[56px] flex flex-col items-center justify-center gap-0.5 p-2 cursor-pointer transition-colors w-full h-full",
          !isPast && "hover:bg-slate-50"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", isPast ? "bg-slate-300" : "bg-green-500")} />
          <span className="text-sm font-semibold text-slate-800">
            {formatHours(cap.scheduledHours > 0 ? cap.scheduledHours : cap.availableHours)}
          </span>
        </div>
        {hasPositiveEvents && (
          <span className="text-[10px] text-slate-400 font-medium">
            +{formatHours(cap.positiveEventHours)} {otLabel}
          </span>
        )}
      </div>

      {onOTClick && !isPast && (
        <button
          className={cn(
            "absolute top-1 right-1 z-10",
            "opacity-0 group-hover/ot-wrap:opacity-100 transition-opacity",
            "flex items-center gap-0.5 px-1.5 py-0.5 rounded-md",
            "bg-white border border-slate-200 hover:border-slate-400 shadow-sm",
            "text-[10px] text-slate-500 hover:text-slate-800 font-medium"
          )}
          onClick={(e) => { e.stopPropagation(); onOTClick(); }}
          title="Ajouter OT / plage"
        >
          <Plus className="w-2.5 h-2.5" />
          OT
        </button>
      )}
    </div>
  );
}

// ─── Helpers OT ──────────────────────────────────────────────────────────────

type OTSlot = {
  id: "before" | "lunch" | "after";
  label: string;
  start: string;
  end: string;
  durationMin: number;
};

function addMinutesToTime(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + min;
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function computeOTSlots(schedule: EmployeeWorkSchedule | undefined): OTSlot[] {
  if (!schedule) return [];
  const slots: OTSlot[] = [];
  const amStart = schedule.am_start?.slice(0, 5);
  const amEnd   = schedule.am_end?.slice(0, 5);
  const pmStart = schedule.pm_start?.slice(0, 5);
  const pmEnd   = schedule.pm_end?.slice(0, 5);

  if (amStart) slots.push({ id: "before", label: "Avant shift", start: addMinutesToTime(amStart, -30), end: amStart, durationMin: 30 });
  if (amEnd && pmStart) {
    const dur = timeToMinutes(pmStart) - timeToMinutes(amEnd);
    if (dur > 0) slots.push({ id: "lunch", label: "Heure du midi", start: amEnd, end: pmStart, durationMin: dur });
  }
  const shiftEnd = pmEnd ?? amEnd;
  if (shiftEnd) slots.push({ id: "after", label: "Après shift", start: shiftEnd, end: addMinutesToTime(shiftEnd, 30), durationMin: 30 });
  return slots;
}

// ─── Modal Événement unifié (absence + overtime) ──────────────────────────────

type EventForm = {
  event_type: CapacityEventType | "";
  nethris_reason_id: NethrisAbsenceReasonId | null;
  fullDay: boolean;
  startTime: string;
  endTime: string;
  notes: string;
  repeatWeekdays: number[];
};

function CapacityEventModal({
  employee,
  dateStr,
  defaultMode,
  existingEvent,
  schedules,
  weekDays,
  onClose,
  onSaved,
}: {
  employee: Employee;
  dateStr: string;
  defaultMode: "absence" | "overtime";
  existingEvent: CapacityEvent | null;
  schedules: EmployeeWorkSchedule[];
  weekDays: Date[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const isoDay = getISODay(new Date(dateStr + "T00:00:00"));

  // Trouver l'horaire pour ce jour
  const empSchedule = schedules.find(
    (s) => s.weekday === isoDay && s.effective_to === null
  );
  const defaultStart = empSchedule?.am_start?.slice(0, 5) ?? "08:00";
  const defaultEnd   = empSchedule?.pm_end?.slice(0, 5) ?? empSchedule?.am_end?.slice(0, 5) ?? "17:00";

  const slots = computeOTSlots(empSchedule);

  function initForm(): EventForm {
    if (existingEvent) {
      const start = parseISO(existingEvent.start_datetime);
      const end   = parseISO(existingEvent.end_datetime);
      const isFullDay = start.getHours() === 0 && start.getMinutes() === 0;
      return {
        event_type: existingEvent.event_type,
        nethris_reason_id: existingEvent.nethris_reason_id ?? null,
        fullDay: isFullDay,
        startTime: isFullDay ? defaultStart : format(start, "HH:mm"),
        endTime:   isFullDay ? defaultEnd   : format(end,   "HH:mm"),
        notes: existingEvent.notes ?? "",
        repeatWeekdays: [isoDay],
      };
    }
    const defaultReason = NETHRIS_ABSENCE_REASONS.find((r) => r.id === "flex")!;
    return {
      event_type: defaultMode === "overtime" ? "overtime" : defaultReason.event_type,
      nethris_reason_id: defaultMode === "overtime" ? null : defaultReason.id,
      fullDay: defaultMode === "absence",
      startTime: defaultStart,
      endTime:   defaultEnd,
      notes: "",
      repeatWeekdays: [isoDay],
    };
  }

  const [form, setForm] = useState<EventForm>(initForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<Array<"before" | "lunch" | "after" | "custom">>([]);

  const isEditing = !!existingEvent;
  const isOvertime = CAPACITY_EVENT_POSITIVE_TYPES.includes(form.event_type as CapacityEventType);
  const isBankAbsence = !isOvertime;

  const weekdayDates = weekDays.slice(0, 5).map((d, i) => ({
    weekday: i + 1,
    dateStr: formatDate(d),
    label: WEEKDAY_LABELS[i + 1],
  }));

  function buildDatetimes(targetDateStr: string): { start: string; end: string } {
    if (form.fullDay) {
      return {
        start: new Date(targetDateStr + "T00:00:00").toISOString(),
        end:   new Date(targetDateStr + "T23:59:59").toISOString(),
      };
    }
    return {
      start: new Date(targetDateStr + "T" + form.startTime).toISOString(),
      end:   new Date(targetDateStr + "T" + form.endTime).toISOString(),
    };
  }

  async function handleSave() {
    if (!form.event_type) return;
    setSaving(true);

    if (isBankAbsence && !form.nethris_reason_id) {
      setSaving(false);
      return;
    }

    const reasonId = isBankAbsence ? form.nethris_reason_id : null;

    if (isEditing && existingEvent) {
      const { start, end } = buildDatetimes(dateStr);
      await supabase.from("capacity_events").update({
        event_type:         form.event_type,
        nethris_reason_id:  reasonId,
        start_datetime:     start,
        end_datetime:       end,
        notes: form.notes.trim() || null,
      } satisfies Partial<CapacityEventInsert>).eq("id", existingEvent.id);
    } else if (isOvertime) {
      // OT : insérer chaque slot sélectionné
      const entries: Array<{ start: string; end: string }> = [];
      for (const slotId of selectedSlots) {
        if (slotId === "custom") {
          entries.push({
            start: new Date(dateStr + "T" + form.startTime).toISOString(),
            end:   new Date(dateStr + "T" + form.endTime).toISOString(),
          });
        } else {
          const slot = slots.find((s) => s.id === slotId);
          if (slot) {
            entries.push({
              start: new Date(dateStr + "T" + slot.start).toISOString(),
              end:   new Date(dateStr + "T" + slot.end).toISOString(),
            });
          }
        }
      }
      for (const entry of entries) {
        await supabase.from("capacity_events").insert({
          employee_id:       employee.id,
          event_type:        form.event_type,
          nethris_reason_id: null,
          start_datetime:    entry.start,
          end_datetime:      entry.end,
          notes: form.notes.trim() || null,
        } satisfies CapacityEventInsert);
      }
    } else {
      // Absence : créer pour chaque jour sélectionné
      const targetDays = weekdayDates.filter((d) => form.repeatWeekdays.includes(d.weekday));
      if (targetDays.length === 0) targetDays.push({ dateStr, weekday: isoDay, label: "" });

      for (const { dateStr: targetDate } of targetDays) {
        const { start, end } = buildDatetimes(targetDate);
        const { error } = await supabase.from("capacity_events").insert({
          employee_id:       employee.id,
          event_type:        form.event_type,
          nethris_reason_id: reasonId,
          start_datetime:    start,
          end_datetime:      end,
          notes: form.notes.trim() || null,
        } satisfies CapacityEventInsert);
        if (error) {
          console.error("Erreur sauvegarde absence:", error.message, error.code, error.details);
          alert(`Erreur (${error.code ?? "??"}) : ${error.message ?? JSON.stringify(error)}\n\nSi la table n'est pas trouvée, exécuter dans Supabase SQL Editor :\nNOTIFY pgrst, 'reload schema';`);
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    onSaved();
  }

  async function handleDelete() {
    if (!existingEvent) return;
    setDeleting(true);
    await supabase.from("capacity_events").delete().eq("id", existingEvent.id);
    setDeleting(false);
    onSaved();
  }

  const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE d MMMM", { locale: fr });
  const canSave = !!form.event_type && (
    (!isBankAbsence || !!form.nethris_reason_id) &&
    (isEditing ||
      (isOvertime ? selectedSlots.length > 0 : form.repeatWeekdays.length > 0))
  );

  const POSITIVE_TYPES = ["overtime", "part_time_boost", "time_recovery"] as const;

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? "Modifier l'événement" : "Ajouter un événement de capacité"}
      size="md"
    >
      <div className="space-y-4">
        {/* Employé + date */}
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600 flex-shrink-0">
            {employee.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm">{employee.full_name}</p>
            <p className="text-xs text-slate-500 capitalize">{dateLabel}</p>
          </div>
        </div>

        {/* Type — grille 2 colonnes */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Type d&apos;événement</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Positifs (+)</p>
              {POSITIVE_TYPES.map((t) => (
                <button key={t} type="button"
                  onClick={() => setForm((p) => ({ ...p, event_type: t, nethris_reason_id: null, fullDay: false }))}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg border-2 text-sm transition-colors",
                    form.event_type === t && !form.nethris_reason_id ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  )}>
                  {CAPACITY_EVENT_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Absences (−)</p>
              {NETHRIS_ABSENCE_REASONS.map((r) => (
                <button key={r.id} type="button"
                  onClick={() => setForm((p) => ({
                    ...p,
                    event_type: r.event_type,
                    nethris_reason_id: r.id,
                    fullDay: true,
                  }))}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg border-2 text-sm transition-colors",
                    form.nethris_reason_id === r.id ? "border-red-400 bg-red-50 text-red-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  )}>
                  {r.supervisor_label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Plages OT */}
        {!isEditing && isOvertime && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Plages horaires</p>
            <div className="space-y-2">
              {slots.map((slot) => (
                <label key={slot.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedSlots.includes(slot.id) ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                  )}>
                  <input type="checkbox" checked={selectedSlots.includes(slot.id)}
                    onChange={() => setSelectedSlots((p) => p.includes(slot.id) ? p.filter((s) => s !== slot.id) : [...p, slot.id])}
                    className="accent-slate-800 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-800">{slot.label}</span>
                    <span className="text-xs text-slate-400 ml-2">{slot.start} – {slot.end}</span>
                  </div>
                  <span className="text-xs text-slate-400 font-medium flex-shrink-0">+{slot.durationMin} min</span>
                </label>
              ))}
              <label className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                selectedSlots.includes("custom") ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300"
              )}>
                <input type="checkbox" checked={selectedSlots.includes("custom")}
                  onChange={() => setSelectedSlots((p) => p.includes("custom") ? p.filter((s) => s !== "custom") : [...p, "custom"])}
                  className="accent-slate-800 flex-shrink-0" />
                <span className="text-sm font-medium text-slate-800">Plage personnalisée</span>
              </label>
              {selectedSlots.includes("custom") && (
                <div className="ml-8 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Début</label>
                    <input type="time" value={form.startTime}
                      onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Fin</label>
                    <input type="time" value={form.endTime}
                      onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Édition OT */}
        {isEditing && isOvertime && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Début</label>
              <input type="time" value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Fin</label>
              <input type="time" value={form.endTime}
                onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
        )}

        {/* Durée (absence) */}
        {!isOvertime && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Durée</p>
            <div className="flex gap-3 mb-3">
              {[true, false].map((fd) => (
                <label key={String(fd)} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.fullDay === fd}
                    onChange={() => setForm((p) => ({ ...p, fullDay: fd }))}
                    className="accent-slate-800" />
                  <span className="text-sm text-slate-700">{fd ? "Journée complète" : "Personnalisé"}</span>
                </label>
              ))}
            </div>
            {!form.fullDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Début</label>
                  <input type="time" value={form.startTime}
                    onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Fin</label>
                  <input type="time" value={form.endTime}
                    onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Répétition (absence uniquement, création) */}
        {!isEditing && !isOvertime && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Appliquer sur</p>
            <div className="flex gap-2 flex-wrap">
              {weekdayDates.map(({ weekday, label }) => (
                <label key={weekday} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox"
                    checked={form.repeatWeekdays.includes(weekday)}
                    onChange={(e) => setForm((p) => ({
                      ...p,
                      repeatWeekdays: e.target.checked
                        ? [...p.repeatWeekdays, weekday]
                        : p.repeatWeekdays.filter((d) => d !== weekday),
                    }))}
                    className="accent-slate-800 rounded" />
                  <span className={cn("text-sm", form.repeatWeekdays.includes(weekday) ? "text-slate-900 font-medium" : "text-slate-500")}>
                    {label.slice(0, 3)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Note */}
        <Input
          label="Note (optionnel)"
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Ex: Rendez-vous médical, livraison urgente…"
        />

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          {isEditing ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Confirmer la suppression ?</span>
                <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "…" : "Oui, supprimer"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Annuler</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}
                className="text-red-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Supprimer
              </Button>
            )
          ) : <div />}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !canSave}>
              {saving ? "Enregistrement…" : isEditing ? "Enregistrer" : "Ajouter"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Disponibilité hebdomadaire (temps partiel) ────────────────────────

function WeeklyAvailabilityModal({
  employee,
  initialWeekStart,
  allSchedules,
  onClose,
  onSaved,
}: {
  employee: Employee;
  initialWeekStart: Date;
  allSchedules: EmployeeWorkSchedule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [weekStart, setWeekStart] = useState<Date>(initialWeekStart);
  const [saving, setSaving] = useState(false);

  const weekDays = getWeekDays(weekStart).slice(0, 5); // lun–ven

  type DayEntry = { enabled: boolean; start: string; end: string };
  const defaultEntry = (): DayEntry => ({ enabled: false, start: "08:00", end: "17:00" });

  function buildInitialDays(): Record<number, DayEntry> {
    const map: Record<number, DayEntry> = {};
    weekDays.forEach((day, i) => {
      const isoDay = i + 1; // 1=lun
      const dateStr = formatDate(day);
      // Chercher un record spécifique à ce jour exactement
      const existing = allSchedules.find(
        (s) => s.employee_id === employee.id &&
               s.weekday === isoDay &&
               s.effective_from === dateStr &&
               s.effective_to === dateStr
      );
      if (existing) {
        const start = existing.am_start?.slice(0, 5) ?? "08:00";
        const end   = (existing.pm_end ?? existing.am_end)?.slice(0, 5) ?? "17:00";
        map[isoDay] = { enabled: true, start, end };
      } else {
        map[isoDay] = defaultEntry();
      }
    });
    return map;
  }

  const [days, setDays] = useState<Record<number, DayEntry>>(buildInitialDays);

  // Recalculer quand on change de semaine
  React.useEffect(() => {
    setDays(buildInitialDays());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  function toggleDay(isoDay: number) {
    setDays((prev) => ({ ...prev, [isoDay]: { ...prev[isoDay], enabled: !prev[isoDay].enabled } }));
  }

  function updateField(isoDay: number, field: "start" | "end", value: string) {
    setDays((prev) => ({ ...prev, [isoDay]: { ...prev[isoDay], [field]: value } }));
  }

  const totalHours = Object.values(days).reduce((sum, d) => {
    if (!d.enabled) return sum;
    const [sh, sm] = d.start.split(":").map(Number);
    const [eh, em] = d.end.split(":").map(Number);
    return sum + Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
  }, 0);

  async function handleSave() {
    setSaving(true);
    for (let i = 0; i < weekDays.length; i++) {
      const day    = weekDays[i];
      const isoDay = i + 1;
      const dateStr = formatDate(day);
      const entry  = days[isoDay];

      // Supprimer l'éventuel record existant pour ce jour exact
      await supabase.from("employee_work_schedule")
        .delete()
        .eq("employee_id", employee.id)
        .eq("weekday", isoDay)
        .eq("effective_from", dateStr)
        .eq("effective_to", dateStr);

      if (entry.enabled) {
        await supabase.from("employee_work_schedule").insert({
          employee_id:    employee.id,
          weekday:        isoDay,
          am_start:       entry.start,
          am_end:         entry.end,
          pm_start:       null,
          pm_end:         null,
          effective_from: dateStr,
          effective_to:   dateStr,
        });
      }
    }
    setSaving(false);
    onSaved();
  }

  const DAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven"];

  return (
    <Modal
      open={true}
      title={`Disponibilité — ${employee.full_name}`}
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-5">
        {/* Navigation semaine */}
        <div className="flex items-center justify-between">
          <button onClick={() => setWeekStart((w) => subWeeks(w, 1))}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm font-semibold text-slate-700">
            Semaine du {format(weekDays[0], "d", { locale: fr })} au {format(weekDays[4], "d MMM yyyy", { locale: fr })}
          </span>
          <button onClick={() => setWeekStart((w) => addWeeks(w, 1))}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        {/* Grille horizontale */}
        <div className="grid grid-cols-5 gap-2">
          {weekDays.map((day, i) => {
            const isoDay = i + 1;
            const entry  = days[isoDay];
            const [sh, sm] = entry.start.split(":").map(Number);
            const [eh, em] = entry.end.split(":").map(Number);
            const h = entry.enabled ? Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60) : 0;

            return (
              <div
                key={isoDay}
                onClick={() => toggleDay(isoDay)}
                className={cn(
                  "rounded-xl border-2 p-3 flex flex-col gap-2 cursor-pointer transition-colors select-none",
                  entry.enabled
                    ? "border-slate-800 bg-white"
                    : "border-slate-200 bg-slate-50"
                )}
              >
                {/* En-tête jour */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className={cn("text-xs font-bold uppercase tracking-wide", entry.enabled ? "text-slate-700" : "text-slate-400")}>
                      {DAY_SHORT[i]}
                    </p>
                    <p className={cn("text-[11px]", entry.enabled ? "text-slate-500" : "text-slate-300")}>
                      {format(day, "d MMM", { locale: fr })}
                    </p>
                  </div>
                  {/* Checkbox visuelle */}
                  <div className={cn(
                    "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0",
                    entry.enabled ? "border-slate-800 bg-slate-800" : "border-slate-300 bg-white"
                  )}>
                    {entry.enabled && <span className="text-white text-[9px] font-bold">✓</span>}
                  </div>
                </div>

                {/* Heures — visibles seulement si activé */}
                {entry.enabled && (
                  <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-0.5">Début</p>
                      <input type="time" value={entry.start}
                        onChange={(e) => updateField(isoDay, "start", e.target.value)}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs text-center bg-slate-50 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-0.5">Fin</p>
                      <input type="time" value={entry.end}
                        onChange={(e) => updateField(isoDay, "end", e.target.value)}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs text-center bg-slate-50 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <p className="text-xs font-semibold text-slate-700 text-center">{formatHours(h)}</p>
                  </div>
                )}

                {!entry.enabled && (
                  <p className="text-[11px] text-slate-300 text-center mt-1">—</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Total + actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <span className="text-sm text-slate-500">
            Total planifié : <span className="font-semibold text-slate-700">{formatHours(totalHours)}</span>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-3.5 h-3.5" />
              {saving ? "Enregistrement…" : "Enregistrer la semaine"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Employé (horaire + profil + congé) ─────────────────────────────────

function EmployeeModal({
  employee,
  tab,
  schedules,
  allSchedules,
  leaves,
  onTabChange,
  onClose,
  onSaved,
}: {
  employee: Employee;
  tab: "schedule" | "profile" | "leave";
  schedules: EmployeeWorkSchedule[];
  allSchedules: EmployeeWorkSchedule[];
  leaves: EmployeeLeave[];
  onTabChange: (t: "schedule" | "profile" | "leave") => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();

  // ─── Onglet Horaire ───────────────────────────────────────────

  // Horaires actifs (effective_to = null) et historiques (effective_to non-null)
  const activeSchedules  = allSchedules.filter((s) => s.employee_id === employee.id && s.effective_to === null);
  const historicSchedules = allSchedules.filter((s) => s.employee_id === employee.id && s.effective_to !== null && s.effective_from !== s.effective_to);

  // effective_from commun de l'horaire actif (premier lundi trouvé)
  const activeFrom = activeSchedules[0]?.effective_from ?? null;

  function buildScheduleMap(): ScheduleMap {
    const map: ScheduleMap = {};
    for (let day = 1; day <= 5; day++) {
      const found = activeSchedules.find((s) => s.weekday === day);
      map[day] = {
        am_start: found?.am_start?.slice(0, 5) ?? "",
        am_end:   found?.am_end?.slice(0, 5)   ?? "",
        pm_start: found?.pm_start?.slice(0, 5) ?? "",
        pm_end:   found?.pm_end?.slice(0, 5)   ?? "",
      };
    }
    return map;
  }

  const [scheduleDraft, setScheduleDraft]     = useState<ScheduleMap>(buildScheduleMap);
  const [savingSchedule, setSavingSchedule]   = useState(false);
  const [versionMode, setVersionMode]         = useState(false);
  const [newEffectiveFrom, setNewEffectiveFrom] = useState("");
  const [newEffectiveTo, setNewEffectiveTo]   = useState("");
  const [showHistory, setShowHistory]         = useState(false);

  function updateDraft(day: number, field: keyof DaySchedule, value: string) {
    setScheduleDraft((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  }

  /** Sauvegarde l'horaire : mise à jour simple OU création d'une nouvelle version */
  async function handleSaveSchedule() {
    setSavingSchedule(true);

    if (versionMode && newEffectiveFrom) {
      // 1. Fermer les records actifs : effective_to = newEffectiveFrom - 1 jour
      const dayBefore = new Date(newEffectiveFrom + "T00:00:00");
      dayBefore.setDate(dayBefore.getDate() - 1);
      const closingDate = formatDate(dayBefore);

      for (const s of activeSchedules) {
        await supabase.from("employee_work_schedule")
          .update({ effective_to: closingDate })
          .eq("id", s.id);
      }

      // 2. Insérer le nouvel horaire
      for (let day = 1; day <= 5; day++) {
        const d = scheduleDraft[day] ?? DEFAULT_DAY;
        if (!d.am_start && !d.am_end && !d.pm_start && !d.pm_end) continue; // jour vide = pas de record
        await supabase.from("employee_work_schedule").insert({
          employee_id:    employee.id,
          weekday:        day,
          am_start:       d.am_start || null,
          am_end:         d.am_end   || null,
          pm_start:       d.pm_start || null,
          pm_end:         d.pm_end   || null,
          effective_from: newEffectiveFrom,
          effective_to:   newEffectiveTo || null,
        });
      }
      setVersionMode(false);
      setNewEffectiveFrom("");
      setNewEffectiveTo("");
    } else {
      // Mise à jour simple — on modifie les records actifs en place
      for (let day = 1; day <= 5; day++) {
        const d = scheduleDraft[day] ?? DEFAULT_DAY;
        const row = {
          employee_id:    employee.id,
          weekday:        day,
          am_start:       d.am_start || null,
          am_end:         d.am_end   || null,
          pm_start:       d.pm_start || null,
          pm_end:         d.pm_end   || null,
          effective_from: "2020-01-01",
          effective_to:   null as null,
        };
        const existing = activeSchedules.find((s) => s.weekday === day);
        if (existing) {
          await supabase.from("employee_work_schedule").update({
            am_start: row.am_start, am_end: row.am_end,
            pm_start: row.pm_start, pm_end: row.pm_end,
          }).eq("id", existing.id);
        } else {
          await supabase.from("employee_work_schedule").insert(row);
        }
      }
    }

    setSavingSchedule(false);
    onSaved();
  }

  // ─── Onglet Profil ────────────────────────────────────────────

  const [profileForm, setProfileForm] = useState({
    full_name: employee.full_name,
    employment_type: employee.employment_type as "full_time" | "part_time",
    hired_at: employee.hired_at ?? "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [deactivateDate, setDeactivateDate] = useState(new Date().toISOString().slice(0, 10));
  const [showDeactivateForm, setShowDeactivateForm] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  async function handleSaveProfile() {
    if (!profileForm.full_name.trim()) return;
    setSavingProfile(true);
    await supabase.from("employees").update({
      full_name: profileForm.full_name.trim(),
      employment_type: profileForm.employment_type,
      hired_at: profileForm.hired_at || null,
    }).eq("id", employee.id);
    setSavingProfile(false);
    onSaved();
  }

  async function handleDeactivate() {
    if (!deactivateDate) return;
    setActionPending(true);
    await supabase.from("employees").update({
      is_active: false,
      deactivated_at: new Date(deactivateDate + "T23:59:59").toISOString(),
    }).eq("id", employee.id);
    setActionPending(false);
    onSaved();
  }

  async function handleReactivate() {
    setActionPending(true);
    await supabase.from("employees").update({ is_active: true, deactivated_at: null }).eq("id", employee.id);
    setActionPending(false);
    onSaved();
  }

  // ─── Onglet Congé prolongé ────────────────────────────────────

  type LeaveForm = {
    reason: "medical" | "injury" | "mental" | "personal" | "other";
    start_date: string;
    end_date: string;
    notes: string;
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const [leaveForm, setLeaveForm] = useState<LeaveForm | null>(null);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [savingLeave, setSavingLeave] = useState(false);
  const [deletingLeaveId, setDeletingLeaveId] = useState<string | null>(null);

  function startAddLeave() {
    setEditingLeaveId(null);
    setLeaveForm({ reason: "medical", start_date: todayStr, end_date: "", notes: "" });
  }

  function startEditLeave(lv: EmployeeLeave) {
    setEditingLeaveId(lv.id);
    setLeaveForm({ reason: lv.reason, start_date: lv.start_date, end_date: lv.end_date ?? "", notes: lv.notes ?? "" });
  }

  function cancelLeaveForm() { setLeaveForm(null); setEditingLeaveId(null); }

  async function handleSaveLeave() {
    if (!leaveForm || !leaveForm.start_date) return;
    setSavingLeave(true);
    const payload: EmployeeLeaveInsert = {
      employee_id: employee.id,
      reason: leaveForm.reason,
      start_date: leaveForm.start_date,
      end_date: leaveForm.end_date || null,
      notes: leaveForm.notes.trim() || null,
    };
    if (editingLeaveId) {
      await supabase.from("employee_leaves").update(payload).eq("id", editingLeaveId);
    } else {
      await supabase.from("employee_leaves").insert(payload);
    }
    setSavingLeave(false);
    cancelLeaveForm();
    onSaved();
  }

  async function handleDeleteLeave(leaveId: string) {
    setDeletingLeaveId(leaveId);
    await supabase.from("employee_leaves").delete().eq("id", leaveId);
    setDeletingLeaveId(null);
    onSaved();
  }

  // ─── Rendu ───────────────────────────────────────────────────────────

  return (
    <Modal open onClose={onClose} title={employee.full_name} size="lg">
      {/* Onglets */}
      <div className="-mt-1 mb-5 flex gap-1 border-b border-slate-200">
        {(["schedule", "profile", "leave"] as const).map((t) => (
          <button key={t} onClick={() => onTabChange(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t ? "border-slate-800 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            )}>
            {t === "schedule" ? "Horaire" : t === "profile" ? "Profil" : (
              <span className="flex items-center gap-1.5">
                Congé prolongé
                {leaves.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "leave" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Un employé en congé prolongé est <strong className="text-slate-700">exclu des compteurs, des alertes et des KPI</strong> pendant toute la période. Il n&apos;apparaît pas dans le calendrier.
          </p>

          {leaves.length > 0 && (
            <div className="space-y-2">
              {leaves.map((lv) => {
                const isOngoing  = !lv.end_date;
                const isEditingThis = editingLeaveId === lv.id && leaveForm !== null;
                return (
                  <div key={lv.id} className={cn("p-3 rounded-lg border", isOngoing ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {LEAVE_REASON_LABELS[lv.reason] ?? lv.reason}
                          {isOngoing && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">En cours</span>}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {lv.start_date}{lv.end_date ? ` → ${lv.end_date}` : " → à définir"}
                        </p>
                        {lv.notes && <p className="text-xs text-slate-400 mt-0.5 italic">{lv.notes}</p>}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => startEditLeave(lv)}>Modifier</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteLeave(lv.id)} disabled={!!deletingLeaveId}
                          className="text-red-400 hover:text-red-600 hover:bg-red-50">
                          {deletingLeaveId === lv.id ? "…" : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>

                    {isEditingThis && leaveForm && (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
                        <select value={leaveForm.reason}
                          onChange={(e) => setLeaveForm((p) => p && ({ ...p, reason: e.target.value as LeaveForm["reason"] }))}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                          {Object.entries(LEAVE_REASON_LABELS).map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Date de début</label>
                            <input type="date" value={leaveForm.start_date}
                              onChange={(e) => setLeaveForm((p) => p && ({ ...p, start_date: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Date de retour <span className="text-slate-400">(optionnel)</span></label>
                            <input type="date" value={leaveForm.end_date}
                              onChange={(e) => setLeaveForm((p) => p && ({ ...p, end_date: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                          </div>
                        </div>
                        <Input label="Note (optionnel)" value={leaveForm.notes}
                          onChange={(e) => setLeaveForm((p) => p && ({ ...p, notes: e.target.value }))}
                          placeholder="Ex: CNESST, médecin de famille" />
                        <div className="flex gap-2 justify-end">
                          <Button variant="secondary" size="sm" onClick={cancelLeaveForm}>Annuler</Button>
                          <Button size="sm" onClick={handleSaveLeave} disabled={savingLeave || !leaveForm?.start_date}>
                            {savingLeave ? "…" : "Enregistrer"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {leaveForm && !editingLeaveId ? (
            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
              <p className="text-sm font-semibold text-slate-700">Nouveau congé prolongé</p>
              <select value={leaveForm.reason}
                onChange={(e) => setLeaveForm((p) => p && ({ ...p, reason: e.target.value as LeaveForm["reason"] }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                {Object.entries(LEAVE_REASON_LABELS).map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Date de début</label>
                  <input type="date" value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm((p) => p && ({ ...p, start_date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Date de retour <span className="text-slate-400">(optionnel)</span></label>
                  <input type="date" value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm((p) => p && ({ ...p, end_date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              </div>
              <Input label="Note (optionnel)" value={leaveForm.notes}
                onChange={(e) => setLeaveForm((p) => p && ({ ...p, notes: e.target.value }))}
                placeholder="Ex: CNESST, médecin de famille" />
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={cancelLeaveForm}>Annuler</Button>
                <Button size="sm" onClick={handleSaveLeave} disabled={savingLeave || !leaveForm?.start_date}>
                  {savingLeave ? "Enregistrement…" : "Ajouter le congé"}
                </Button>
              </div>
            </div>
          ) : !leaveForm && (
            <Button variant="secondary" onClick={startAddLeave}>
              <Plus className="w-3.5 h-3.5" /> Ajouter un congé prolongé
            </Button>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <div className="space-y-4">

          {/* Bandeau version active */}
          {activeFrom && !versionMode && (
            <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
              <span className="text-xs text-slate-500">
                Actif depuis le <span className="font-semibold text-slate-700">{format(parseISO(activeFrom), "d MMM yyyy", { locale: fr })}</span>
              </span>
              <button
                onClick={() => { setVersionMode(true); setScheduleDraft(buildScheduleMap()); }}
                className="text-xs text-slate-500 hover:text-slate-800 underline transition-colors"
              >
                Changer l&apos;horaire à partir d&apos;une date…
              </button>
            </div>
          )}

          {/* Formulaire de nouvelle version */}
          {versionMode && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800">Nouvelle version d&apos;horaire</p>
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <label className="text-[11px] text-amber-700 font-medium block mb-1">À partir du *</label>
                  <input type="date" value={newEffectiveFrom}
                    onChange={(e) => setNewEffectiveFrom(e.target.value)}
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="text-[11px] text-amber-700 font-medium block mb-1">Jusqu&apos;au (optionnel)</label>
                  <input type="date" value={newEffectiveTo}
                    onChange={(e) => setNewEffectiveTo(e.target.value)}
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <button
                  onClick={() => { setVersionMode(false); setScheduleDraft(buildScheduleMap()); }}
                  className="self-end text-xs text-amber-600 hover:text-amber-800 pb-1 underline"
                >
                  Annuler
                </button>
              </div>
              <p className="text-[11px] text-amber-700">L&apos;horaire actuel sera conservé dans l&apos;historique.</p>
            </div>
          )}

          {/* Tableau horaire */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left pb-3 w-24">Jour</th>
                <th className="text-center pb-3">AM début</th>
                <th className="text-center pb-3">AM fin</th>
                <th className="text-center pb-3">PM début</th>
                <th className="text-center pb-3">PM fin</th>
                <th className="text-center pb-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[1, 2, 3, 4, 5].map((day) => {
                const d = scheduleDraft[day] ?? DEFAULT_DAY;
                const amH = d.am_start && d.am_end ? (timeToMinutes(d.am_end) - timeToMinutes(d.am_start)) / 60 : 0;
                const pmH = d.pm_start && d.pm_end ? (timeToMinutes(d.pm_end) - timeToMinutes(d.pm_start)) / 60 : 0;
                const total = amH + pmH;
                return (
                  <tr key={day}>
                    <td className="py-2 font-medium text-slate-700">{WEEKDAY_LABELS[day]}</td>
                    {(["am_start", "am_end", "pm_start", "pm_end"] as const).map((field) => (
                      <td key={field} className="py-2 px-1 text-center">
                        <input type="time" value={d[field]}
                          onChange={(e) => updateDraft(day, field, e.target.value)}
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-center bg-slate-50 hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors" />
                      </td>
                    ))}
                    <td className="py-2 text-center">
                      <span className={cn("text-sm font-semibold", total > 0 ? "text-green-600" : "text-slate-300")}>
                        {total > 0 ? formatHours(total) : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Historique des versions */}
          {historicSchedules.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
              >
                <ChevronRight className={cn("w-3 h-3 transition-transform", showHistory && "rotate-90")} />
                {showHistory ? "Masquer" : "Voir"} l&apos;historique ({historicSchedules.length} versions)
              </button>
              {showHistory && (
                <div className="mt-2 space-y-1">
                  {/* Grouper par effective_from */}
                  {Array.from(new Set(historicSchedules.map((s) => s.effective_from))).sort().reverse().map((ef) => {
                    const records = historicSchedules.filter((s) => s.effective_from === ef);
                    const et = records[0]?.effective_to;
                    const totalH = records.reduce((sum, s) => {
                      const amH = s.am_start && s.am_end ? (timeToMinutes(s.am_end.slice(0, 5)) - timeToMinutes(s.am_start.slice(0, 5))) / 60 : 0;
                      const pmH = s.pm_start && s.pm_end ? (timeToMinutes(s.pm_end.slice(0, 5)) - timeToMinutes(s.pm_start.slice(0, 5))) / 60 : 0;
                      return sum + amH + pmH;
                    }, 0);
                    return (
                      <div key={ef} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded px-3 py-1.5">
                        <span className="font-medium text-slate-500">
                          {format(parseISO(ef), "d MMM yyyy", { locale: fr })}
                          {et ? ` → ${format(parseISO(et), "d MMM yyyy", { locale: fr })}` : ""}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span>{records.length} jour{records.length > 1 ? "s" : ""} / {formatHours(totalH / records.length)}/j moy.</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSaveSchedule} disabled={savingSchedule || (versionMode && !newEffectiveFrom)}>
              <Save className="w-3.5 h-3.5" />
              {savingSchedule ? "Enregistrement…" : versionMode ? "Appliquer le nouvel horaire" : "Enregistrer l'horaire"}
            </Button>
          </div>
        </div>
      )}

      {tab === "profile" && (
        <div className="space-y-4">
          <Input label="Nom complet" value={profileForm.full_name}
            onChange={(e) => setProfileForm((p) => ({ ...p, full_name: e.target.value }))} />

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Type d&apos;emploi</p>
            <div className="grid grid-cols-2 gap-3">
              {(["full_time", "part_time"] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => setProfileForm((p) => ({ ...p, employment_type: t }))}
                  className={cn(
                    "rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors",
                    profileForm.employment_type === t ? "border-slate-800 bg-slate-50 text-slate-800" : "border-slate-200 text-slate-500 hover:border-slate-300"
                  )}>
                  {t === "full_time" ? "Temps plein" : "Temps partiel"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              Date d&apos;embauche <span className="ml-1 text-xs font-normal text-slate-400">(optionnel)</span>
            </label>
            <input type="date" value={profileForm.hired_at}
              onChange={(e) => setProfileForm((p) => ({ ...p, hired_at: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSaveProfile} disabled={savingProfile || !profileForm.full_name.trim()}>
              {savingProfile ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>

          <div className="border-t border-slate-100 pt-4 mt-4">
            {employee.is_active ? (
              !showDeactivateForm ? (
                <Button variant="ghost" size="sm" onClick={() => setShowDeactivateForm(true)}
                  className="text-red-400 hover:text-red-600 hover:bg-red-50">
                  <UserX className="w-4 h-4" /> Désactiver cet employé
                </Button>
              ) : (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-3">
                  <p className="text-sm text-red-700 font-medium">L&apos;employé disparaîtra des projections à partir de cette date.</p>
                  <div>
                    <label className="text-xs text-red-600 block mb-1">Date de désactivation</label>
                    <input type="date" value={deactivateDate}
                      onChange={(e) => setDeactivateDate(e.target.value)}
                      className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="danger" size="sm" onClick={handleDeactivate} disabled={actionPending || !deactivateDate}>
                      {actionPending ? "…" : "Confirmer la désactivation"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowDeactivateForm(false)}>Annuler</Button>
                  </div>
                </div>
              )
            ) : (
              <Button variant="ghost" size="sm" onClick={handleReactivate} disabled={actionPending}
                className="text-green-600 hover:text-green-700 hover:bg-green-50">
                <UserCheck className="w-4 h-4" /> Réactiver cet employé
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
