"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from "recharts";
import { getISODay, subWeeks, addWeeks, format } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  EmployeeWorkSchedule,
  EmployeeExclusionWithType,
  EmployeeAdjustment,
} from "@/lib/supabase/types";
import { computeDayCapacity, formatHours } from "@/lib/capacity";
import { getWeekStart, getWeekDays, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Users, Clock, AlertCircle, Zap } from "lucide-react";

export default function DashboardPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<EmployeeWorkSchedule[]>([]);
  const [exclusions, setExclusions] = useState<EmployeeExclusionWithType[]>([]);
  const [adjustments, setAdjustments] = useState<EmployeeAdjustment[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const todayStr = formatDate(today);
  const weekStart = getWeekStart(today);
  const weekDays = getWeekDays(weekStart);

  // Charger 4 semaines pour les graphiques
  const rangeStart = subWeeks(weekStart, 3);
  const rangeEnd = addWeeks(weekStart, 1);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: scheds }, { data: excs }, { data: adjs }] = await Promise.all([
      // Inclure employés actifs + désactivés après le début de la plage analysée
      supabase.from("employees").select("*")
        .or(`is_active.eq.true,deactivated_at.gte.${rangeStart.toISOString()}`)
        .order("full_name"),
      supabase.from("employee_work_schedule").select("*"),
      supabase
        .from("employee_exclusions")
        .select("*, exclusion_types(*), employees(id, full_name)")
        .lt("start_datetime", rangeEnd.toISOString())
        .gt("end_datetime", rangeStart.toISOString()),
      supabase
        .from("employee_adjustments")
        .select("*, employees(id, full_name)")
        .lt("start_datetime", rangeEnd.toISOString())
        .gt("end_datetime", rangeStart.toISOString()),
    ]);
    setEmployees(emps ?? []);
    setSchedules(scheds ?? []);
    setExclusions((excs as EmployeeExclusionWithType[]) ?? []);
    setAdjustments((adjs as EmployeeAdjustment[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function getCapacity(emp: Employee, dateStr: string) {
    const isoDay = getISODay(new Date(dateStr + "T00:00:00"));
    const schedule = isoDay <= 5
      ? schedules.find((s) => s.employee_id === emp.id && s.weekday === isoDay)
      : undefined;
    const empExclusions = exclusions.filter((e) => e.employee_id === emp.id);
    const empAdjustments = adjustments.filter((a) => a.employee_id === emp.id);
    return computeDayCapacity(emp, dateStr, schedule, empExclusions, empAdjustments);
  }

  // KPI aujourd'hui
  const todayCaps = employees.map((emp) => getCapacity(emp, todayStr));
  const todayAvailable = todayCaps.reduce((s, c) => s + c.availableHours, 0);
  const todayAbsents = todayCaps.filter((c) => c.scheduledHours > 0 && c.availableHours < c.scheduledHours).length;

  // KPI semaine
  const weekCaps = weekDays.slice(0, 5).flatMap((day) =>
    employees.map((emp) => getCapacity(emp, formatDate(day)))
  );
  const weekAbsenceHours = weekCaps.reduce((s, c) => s + c.exclusionHours + c.negativeAdjustmentHours, 0);
  const weekOvertimeHours = weekCaps.filter((c) => c.overtime > 0).reduce((s, c) => s + c.overtime, 0);
  const weekAbsents = new Set(
    weekCaps.filter((c) => c.exclusionHours > 0 || c.negativeAdjustmentHours > 0).map((c) => c.employee.id)
  ).size;

  // Données graphiques — capacité par jour cette semaine
  const weekChartData = weekDays.slice(0, 5).map((day) => {
    const dateStr = formatDate(day);
    const caps = employees.map((emp) => getCapacity(emp, dateStr));
    return {
      name: format(day, "EEE d", { locale: fr }),
      planifié: Math.round(caps.reduce((s, c) => s + c.scheduledHours, 0) * 10) / 10,
      disponible: Math.round(caps.reduce((s, c) => s + c.availableHours, 0) * 10) / 10,
      absences: Math.round(caps.reduce((s, c) => s + c.exclusionHours + c.negativeAdjustmentHours, 0) * 10) / 10,
      overtime: Math.round(caps.filter((c) => c.overtime > 0).reduce((s, c) => s + c.overtime, 0) * 10) / 10,
    };
  });

  // Top absences par employé cette semaine
  const empAbsenceData = employees
    .map((emp) => {
      const hours = weekDays.slice(0, 5).reduce((s, day) => {
        const cap = getCapacity(emp, formatDate(day));
        return s + cap.exclusionHours + cap.negativeAdjustmentHours;
      }, 0);
      return { name: emp.full_name.split(" ")[0], hours: Math.round(hours * 10) / 10 };
    })
    .filter((e) => e.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8);

  // Top overtime par employé
  const empOvertimeData = employees
    .map((emp) => {
      const hours = weekDays.slice(0, 5).reduce((s, day) => {
        const cap = getCapacity(emp, formatDate(day));
        return s + Math.max(0, cap.overtime);
      }, 0);
      return { name: emp.full_name.split(" ")[0], hours: Math.round(hours * 10) / 10 };
    })
    .filter((e) => e.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8);

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Chargement…</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Dashboard analytique</h1>
        <p className="text-sm text-slate-500 mt-0.5 capitalize">
          Semaine du {format(weekDays[0], "d MMM", { locale: fr })} au {format(weekDays[4], "d MMM yyyy", { locale: fr })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          title="Heures disponibles aujourd'hui"
          value={formatHours(todayAvailable)}
          icon={<Clock className="w-5 h-5" />}
          color="blue"
        />
        <KpiCard
          title="Absents aujourd'hui"
          value={`${todayAbsents}`}
          sub={`sur ${employees.length} actifs`}
          icon={<Users className="w-5 h-5" />}
          color={todayAbsents > 0 ? "orange" : "green"}
        />
        <KpiCard
          title="Heures d'absence cette semaine"
          value={formatHours(weekAbsenceHours)}
          sub={`${weekAbsents} employé(s) affecté(s)`}
          icon={<AlertCircle className="w-5 h-5" />}
          color="red"
        />
        <KpiCard
          title="Overtime cette semaine"
          value={formatHours(weekOvertimeHours)}
          icon={<Zap className="w-5 h-5" />}
          color="purple"
        />
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Capacité par jour */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Capacité nette par jour</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekChartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
              <RechartsTooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                formatter={(value: number) => [`${value}h`, ""]}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="planifié" fill="#e2e8f0" radius={[3, 3, 0, 0]} />
              <Bar dataKey="disponible" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Absences & Overtime */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Absences & Overtime cette semaine</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekChartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
              <RechartsTooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                formatter={(value: number) => [`${value}h`, ""]}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="absences" fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="overtime" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top absences par employé */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Top absences par employé (semaine)</h3>
          {empAbsenceData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucune absence cette semaine</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={empAbsenceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} width={70} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                  formatter={(value: number) => [`${value}h d'absences`, ""]}
                />
                <Bar dataKey="hours" fill="#ef4444" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top overtime par employé */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Top overtime par employé (semaine)</h3>
          {empOvertimeData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucun overtime cette semaine</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={empOvertimeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} width={70} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                  formatter={(value: number) => [`${value}h d'overtime`, ""]}
                />
                <Bar dataKey="hours" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  icon,
  color,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: "blue" | "green" | "orange" | "red" | "purple";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 leading-tight">{title}</p>
        <div className={cn("p-2 rounded-lg flex-shrink-0", colors[color])}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
