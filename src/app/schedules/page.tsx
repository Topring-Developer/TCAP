"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Employee, EmployeeWorkSchedule } from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { WEEKDAY_LABELS } from "@/lib/utils";
import { cn } from "@/lib/utils";

type DaySchedule = {
  am_start: string;
  am_end: string;
  pm_start: string;
  pm_end: string;
};

type EmployeeScheduleMap = Record<string, Record<number, DaySchedule>>;

const DEFAULT_DAY: DaySchedule = { am_start: "", am_end: "", pm_start: "", pm_end: "" };

export default function SchedulesPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<EmployeeWorkSchedule[]>([]);
  const [draft, setDraft] = useState<EmployeeScheduleMap>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: scheds }] = await Promise.all([
      supabase.from("employees").select("*").eq("is_active", true).order("full_name"), // Horaires: actifs seulement
      supabase.from("employee_work_schedule").select("*"),
    ]);

    const empList = emps ?? [];
    const schedList = scheds ?? [];
    setEmployees(empList);
    setSchedules(schedList);

    // Initialiser le draft
    const map: EmployeeScheduleMap = {};
    for (const emp of empList) {
      map[emp.id] = {};
      for (let day = 1; day <= 5; day++) {
        const found = schedList.find((s) => s.employee_id === emp.id && s.weekday === day);
        map[emp.id][day] = {
          am_start: found?.am_start?.slice(0, 5) ?? "",
          am_end: found?.am_end?.slice(0, 5) ?? "",
          pm_start: found?.pm_start?.slice(0, 5) ?? "",
          pm_end: found?.pm_end?.slice(0, 5) ?? "",
        };
      }
    }
    setDraft(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateDraft(empId: string, day: number, field: keyof DaySchedule, value: string) {
    setDraft((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        [day]: { ...prev[empId][day], [field]: value },
      },
    }));
  }

  async function saveEmployee(empId: string) {
    setSaving(empId);
    const empDraft = draft[empId];
    for (let day = 1; day <= 5; day++) {
      const d = empDraft[day] ?? DEFAULT_DAY;
      const row = {
        employee_id: empId,
        weekday: day,
        am_start: d.am_start || null,
        am_end: d.am_end || null,
        pm_start: d.pm_start || null,
        pm_end: d.pm_end || null,
      };
      const existing = schedules.find((s) => s.employee_id === empId && s.weekday === day);
      if (existing) {
        await supabase.from("employee_work_schedule").update(row).eq("id", existing.id);
      } else {
        await supabase.from("employee_work_schedule").insert(row);
      }
    }
    setSaving(null);
    load();
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Chargement…</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Horaires normaux"
        subtitle="Définissez les blocs AM et PM pour chaque employé, du lundi au vendredi"
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const allOpen: Record<string, boolean> = {};
                employees.forEach((e) => { allOpen[e.id] = true; });
                setExpanded(allOpen);
              }}
            >
              <ChevronsUpDown className="w-3.5 h-3.5" /> Tout ouvrir
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded({})}
            >
              <ChevronsDownUp className="w-3.5 h-3.5" /> Tout fermer
            </Button>
          </div>
        }
      />

      <div className="space-y-3">
        {employees.map((emp) => {
          const isExpanded = expanded[emp.id] ?? false;
          return (
            <div key={emp.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* En-tête employé */}
              <button
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
                onClick={() => setExpanded((p) => ({ ...p, [emp.id]: !isExpanded }))}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">
                    {emp.full_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-slate-900">{emp.full_name}</span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>

              {/* Grille des jours */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        <th className="text-left pb-3 w-28">Jour</th>
                        <th className="text-center pb-3">AM début</th>
                        <th className="text-center pb-3">AM fin</th>
                        <th className="text-center pb-3">PM début</th>
                        <th className="text-center pb-3">PM fin</th>
                        <th className="text-center pb-3">Heures</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {[1, 2, 3, 4, 5].map((day) => {
                        const d = draft[emp.id]?.[day] ?? DEFAULT_DAY;
                        const amH = d.am_start && d.am_end
                          ? (timeToMinutes(d.am_end) - timeToMinutes(d.am_start)) / 60
                          : 0;
                        const pmH = d.pm_start && d.pm_end
                          ? (timeToMinutes(d.pm_end) - timeToMinutes(d.pm_start)) / 60
                          : 0;
                        const total = amH + pmH;

                        return (
                          <tr key={day} className="group">
                            <td className="py-2 font-medium text-slate-700 w-28">
                              {WEEKDAY_LABELS[day]}
                            </td>
                            {(["am_start", "am_end", "pm_start", "pm_end"] as const).map((field) => (
                              <td key={field} className="py-2 px-1 text-center">
                                <input
                                  type="time"
                                  value={d[field]}
                                  onChange={(e) => updateDraft(emp.id, day, field, e.target.value)}
                                  className={cn(
                                    "w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-center",
                                    "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                                    "bg-slate-50 hover:bg-white transition-colors"
                                  )}
                                />
                              </td>
                            ))}
                            <td className="py-2 text-center">
                              <span className={cn(
                                "text-sm font-semibold",
                                total > 0 ? "text-green-600" : "text-slate-300"
                              )}>
                                {total > 0 ? `${total}h` : "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="flex justify-end mt-4">
                    <Button
                      size="sm"
                      onClick={() => saveEmployee(emp.id)}
                      disabled={saving === emp.id}
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving === emp.id ? "Enregistrement…" : "Enregistrer"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
