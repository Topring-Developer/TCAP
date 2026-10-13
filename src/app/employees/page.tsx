"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, UserCheck, UserX, Calendar, Clock, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Employee, EmployeeInsert, EmployeeWorkSchedule } from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { formatDateFr, WEEKDAY_LABELS } from "@/lib/utils";
import { cn } from "@/lib/utils";

type FilterStatus = "active" | "inactive" | "all";
type ModalMode = "create" | "edit" | "deactivate" | "schedule";

type DaySchedule = { am_start: string; am_end: string; pm_start: string; pm_end: string };
type ScheduleMap = Record<number, DaySchedule>;
const DEFAULT_DAY: DaySchedule = { am_start: "", am_end: "", pm_start: "", pm_end: "" };

const EMPLOYMENT_LABELS: Record<"full_time" | "part_time", string> = {
  full_time: "Temps plein",
  part_time: "Temps partiel",
};

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function EmployeesPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allSchedules, setAllSchedules] = useState<EmployeeWorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    employment_type: "full_time" as "full_time" | "part_time",
    include_in_receiving_kpi: true,
    hired_at: "",
  });
  const [deactivateDate, setDeactivateDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("active");
  const [filterType, setFilterType] = useState<"all" | "full_time" | "part_time">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Horaire draft + versionnage
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleMap>({});
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleChangeMode, setScheduleChangeMode] = useState<"update" | "version">("update");
  const [scheduleVersionFrom, setScheduleVersionFrom] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: scheds }] = await Promise.all([
      supabase.from("employees").select("*").order("full_name"),
      supabase.from("employee_work_schedule").select("*"),
    ]);
    setEmployees(emps ?? []);
    setAllSchedules(scheds ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Employé CRUD ────────────────────────────────────────────
  function openCreate() {
    setModalMode("create");
    setEditTarget(null);
    setForm({ full_name: "", employment_type: "full_time", include_in_receiving_kpi: true, hired_at: "" });
    setModalOpen(true);
  }

  function openEdit(emp: Employee) {
    setModalMode("edit");
    setEditTarget(emp);
    setForm({
      full_name: emp.full_name,
      employment_type: emp.employment_type,
      include_in_receiving_kpi: emp.include_in_receiving_kpi ?? true,
      hired_at: emp.hired_at ?? "",
    });
    setModalOpen(true);
  }

  function openDeactivate(emp: Employee) {
    setModalMode("deactivate");
    setEditTarget(emp);
    setDeactivateDate(new Date().toISOString().slice(0, 10));
    setModalOpen(true);
  }

  function openSchedule(emp: Employee) {
    setModalMode("schedule");
    setEditTarget(emp);
    setScheduleChangeMode("update");
    setScheduleVersionFrom(new Date().toISOString().slice(0, 10));
    // Initialiser le draft avec les horaires ACTIFS (effective_to IS NULL)
    const map: ScheduleMap = {};
    for (let day = 1; day <= 5; day++) {
      const found = allSchedules.find(
        (s) => s.employee_id === emp.id && s.weekday === day && s.effective_to === null
      );
      map[day] = {
        am_start: found?.am_start?.slice(0, 5) ?? "",
        am_end:   found?.am_end?.slice(0, 5)   ?? "",
        pm_start: found?.pm_start?.slice(0, 5) ?? "",
        pm_end:   found?.pm_end?.slice(0, 5)   ?? "",
      };
    }
    setScheduleDraft(map);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.full_name.trim()) return;
    setSaving(true);
    if (modalMode === "edit" && editTarget) {
      await supabase.from("employees").update({
        full_name: form.full_name.trim(),
        employment_type: form.employment_type,
        include_in_receiving_kpi: form.include_in_receiving_kpi,
        hired_at: form.hired_at || null,
      }).eq("id", editTarget.id);
    } else {
      const insert: EmployeeInsert = {
        full_name: form.full_name.trim(),
        is_active: true,
        employment_type: form.employment_type,
        include_in_receiving_kpi: form.include_in_receiving_kpi,
        hired_at: form.hired_at || null,
      };
      await supabase.from("employees").insert(insert);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function handleDeactivate() {
    if (!editTarget || !deactivateDate) return;
    setSaving(true);
    await supabase.from("employees").update({
      is_active: false,
      deactivated_at: new Date(deactivateDate + "T23:59:59").toISOString(),
    }).eq("id", editTarget.id);
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function handleReactivate(emp: Employee) {
    await supabase.from("employees").update({ is_active: true, deactivated_at: null }).eq("id", emp.id);
    load();
  }

  async function toggleReceivingKpi(emp: Employee) {
    const next = !(emp.include_in_receiving_kpi ?? true);
    await supabase
      .from("employees")
      .update({ include_in_receiving_kpi: next })
      .eq("id", emp.id);
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === emp.id ? { ...e, include_in_receiving_kpi: next } : e
      )
    );
  }

  async function handleSaveSchedule() {
    if (!editTarget) return;
    setSavingSchedule(true);

    for (let day = 1; day <= 5; day++) {
      const d = scheduleDraft[day] ?? DEFAULT_DAY;
      const existing = allSchedules.find(
        (s) => s.employee_id === editTarget.id && s.weekday === day && s.effective_to === null
      );

      if (scheduleChangeMode === "version" && existing) {
        // Fermer la version active (effective_to = veille de la nouvelle date)
        const veille = new Date(scheduleVersionFrom);
        veille.setDate(veille.getDate() - 1);
        const veilleStr = veille.toISOString().slice(0, 10);
        await supabase.from("employee_work_schedule")
          .update({ effective_to: veilleStr })
          .eq("id", existing.id);

        // Insérer la nouvelle version
        await supabase.from("employee_work_schedule").insert({
          employee_id:    editTarget.id,
          weekday:        day,
          am_start:       d.am_start || null,
          am_end:         d.am_end   || null,
          pm_start:       d.pm_start || null,
          pm_end:         d.pm_end   || null,
          effective_from: scheduleVersionFrom,
          effective_to:   null,
        });
      } else {
        // Mise à jour simple de la version active
        const row = {
          employee_id:    editTarget.id,
          weekday:        day,
          am_start:       d.am_start || null,
          am_end:         d.am_end   || null,
          pm_start:       d.pm_start || null,
          pm_end:         d.pm_end   || null,
          effective_from: existing?.effective_from ?? "2020-01-01",
          effective_to:   null,
        };
        if (existing) {
          await supabase.from("employee_work_schedule").update({
            am_start: row.am_start,
            am_end:   row.am_end,
            pm_start: row.pm_start,
            pm_end:   row.pm_end,
          }).eq("id", existing.id);
        } else {
          await supabase.from("employee_work_schedule").insert(row);
        }
      }
    }

    setSavingSchedule(false);
    setModalOpen(false);
    load();
  }

  function updateDraft(day: number, field: keyof DaySchedule, value: string) {
    setScheduleDraft((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  }

  // ─── Filtre ──────────────────────────────────────────────────
  const filtered = employees.filter((e) => {
    const statusOk = filterStatus === "all" || (filterStatus === "active" ? e.is_active : !e.is_active);
    const typeOk = filterType === "all" || e.employment_type === filterType;
    const searchOk = !searchQuery.trim() ||
      e.full_name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return statusOk && typeOk && searchOk;
  });

  const activeCount = employees.filter((e) => e.is_active).length;
  const inactiveCount = employees.filter((e) => !e.is_active).length;
  const fullTimeCount = employees.filter((e) => e.is_active && e.employment_type === "full_time").length;
  const partTimeCount = employees.filter((e) => e.is_active && e.employment_type === "part_time").length;

  // Résumé horaire d'un employé (horaires actifs seulement)
  function getScheduleSummary(empId: string): string {
    const days = allSchedules.filter((s) => s.employee_id === empId && (s.am_start || s.pm_start) && s.effective_to === null);
    if (days.length === 0) return "Aucun horaire";
    const totalH = days.reduce((sum, s) => {
      const am = s.am_start && s.am_end ? (timeToMinutes(s.am_end.slice(0,5)) - timeToMinutes(s.am_start.slice(0,5))) / 60 : 0;
      const pm = s.pm_start && s.pm_end ? (timeToMinutes(s.pm_end.slice(0,5)) - timeToMinutes(s.pm_start.slice(0,5))) / 60 : 0;
      return sum + am + pm;
    }, 0);
    return `${days.length}j · ${totalH}h/sem`;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Employés & Horaires"
        subtitle={`${activeCount} actifs · ${fullTimeCount} temps plein · ${partTimeCount} temps partiel · ${inactiveCount} inactifs`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        }
      />

      {/* Recherche */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Rechercher un employé…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-slate-400"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex gap-1.5">
          {(["active", "inactive", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilterStatus(f)}
              className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filterStatus === f ? "bg-primary text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {f === "active" ? `Actifs (${activeCount})` : f === "inactive" ? `Inactifs (${inactiveCount})` : "Tous"}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["all", "full_time", "part_time"] as const).map((t) => (
            <button key={t} onClick={() => setFilterType(t)}
              className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filterType === t ? "bg-slate-800 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {t === "all" ? "Tous types" : t === "full_time" ? "Temps plein" : "Temps partiel"}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Aucun employé</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {filtered.map((emp) => {
            const typeLabel = EMPLOYMENT_LABELS[emp.employment_type] ?? EMPLOYMENT_LABELS.full_time;
            const inReceiving = emp.include_in_receiving_kpi ?? true;
            const summary = getScheduleSummary(emp.id);
            return (
              <div key={emp.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0",
                    emp.is_active ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-300"
                  )}>
                    {emp.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium truncate", !emp.is_active && "text-slate-400")}>
                      {emp.full_name}
                    </p>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                      {emp.is_active ? (
                        <>
                          <span>{typeLabel}</span>
                          <span className="text-slate-300">·</span>
                          <Clock className="w-3 h-3" />
                          <span>{summary}</span>
                          {!inReceiving && (
                            <>
                              <span className="text-slate-300">·</span>
                              <button
                                type="button"
                                onClick={() => toggleReceivingKpi(emp)}
                                title="Réinclure dans le KPI Réception"
                                className="text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2"
                              >
                                hors récep.
                              </button>
                            </>
                          )}
                        </>
                      ) : emp.deactivated_at ? (
                        `Désactivé le ${formatDateFr(emp.deactivated_at)}`
                      ) : "Inactif"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-0.5 flex-shrink-0 text-slate-400">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openSchedule(emp)}
                    title="Horaire"
                    className="text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  >
                    <Calendar className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(emp)}
                    title="Modifier"
                    className="text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  {emp.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeactivate(emp)}
                      title="Désactiver"
                      className="text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <UserX className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReactivate(emp)}
                      title="Réactiver"
                      className="text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <UserCheck className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Modal Créer / Modifier employé ─────────────────── */}
      <Modal open={modalOpen && (modalMode === "create" || modalMode === "edit")}
        onClose={() => setModalOpen(false)}
        title={modalMode === "edit" ? "Modifier l'employé" : "Ajouter un employé"} size="sm">
        <div className="space-y-4">
          <Input label="Nom complet" value={form.full_name}
            onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Ex: Marie Tremblay" autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()} />
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Type d'emploi</p>
            <div className="grid grid-cols-2 gap-3">
              {(["full_time", "part_time"] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => setForm((p) => ({ ...p, employment_type: t }))}
                  className={cn("rounded-xl border-2 py-3 text-sm font-semibold transition-colors",
                    form.employment_type === t
                      ? "border-slate-800 bg-slate-50 text-slate-800"
                      : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                  {t === "full_time" ? "Temps plein" : "Temps partiel"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              Date d&apos;embauche
              <span className="ml-1 text-xs font-normal text-slate-400">(optionnel)</span>
            </label>
            <input
              type="date"
              value={form.hired_at}
              onChange={(e) => setForm((p) => ({ ...p, hired_at: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-slate-400 mt-1">
              Pour les étudiants saisonniers — évite les faux positifs d&apos;absence dans l&apos;analyse TWMS.
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.include_in_receiving_kpi}
              onChange={(e) => setForm((p) => ({ ...p, include_in_receiving_kpi: e.target.checked }))}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              <span className="text-sm font-medium text-slate-700">Inclure dans le KPI Réception</span>
              <span className="block text-xs text-slate-400 mt-0.5">
                Décochez pour les employés qui ne font pas de réception (ex. production, réparation).
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name.trim()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Modal Désactivation ─────────────────────────────── */}
      <Modal open={modalOpen && modalMode === "deactivate"}
        onClose={() => setModalOpen(false)} title="Désactiver l'employé" size="sm">
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <p className="font-medium mb-1">{editTarget?.full_name}</p>
            <p>L'employé disparaîtra des projections à partir de cette date. Les semaines passées resteront visibles.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Date de désactivation
            </label>
            <input type="date" value={deactivateDate}
              onChange={(e) => setDeactivateDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button variant="danger" onClick={handleDeactivate} disabled={saving || !deactivateDate}>
              {saving ? "Enregistrement…" : "Désactiver"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Modal Horaire ───────────────────────────────────── */}
      <Modal open={modalOpen && modalMode === "schedule"}
        onClose={() => setModalOpen(false)}
        title={`Horaire — ${editTarget?.full_name ?? ""}`} size="lg">
        <div>
          {/* Mode de changement — correction simple vs nouvelle version historique */}
          <div className="mb-5 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Type de modification</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["update", "Correction", "Met à jour l'horaire actuel (pas d'historique)"],
                ["version", "Nouvel horaire", "Crée une nouvelle version — l'ancien est conservé pour les semaines passées"],
              ] as const).map(([mode, title, desc]) => (
                <button key={mode} type="button"
                  onClick={() => setScheduleChangeMode(mode)}
                  className={cn(
                    "text-left rounded-lg border-2 p-2.5 text-sm transition-colors",
                    scheduleChangeMode === mode
                      ? "border-slate-800 bg-white"
                      : "border-slate-200 hover:border-slate-300"
                  )}>
                  <p className={cn("font-semibold", scheduleChangeMode === mode ? "text-slate-900" : "text-slate-500")}>{title}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
            {scheduleChangeMode === "version" && (
              <div>
                <label className="text-xs text-slate-600 block mb-1 font-medium">
                  Date d&apos;entrée en vigueur du nouvel horaire
                </label>
                <input
                  type="date"
                  value={scheduleVersionFrom}
                  onChange={(e) => setScheduleVersionFrom(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  L&apos;horaire précédent sera fermé la veille ({
                    scheduleVersionFrom
                      ? (() => { const d = new Date(scheduleVersionFrom); d.setDate(d.getDate() - 1); return d.toLocaleDateString("fr-CA"); })()
                      : "—"
                  }).
                </p>
              </div>
            )}
          </div>

          <table className="w-full text-sm mb-5">
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
                        {total > 0 ? `${total}h` : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSaveSchedule} disabled={savingSchedule}>
              <Save className="w-3.5 h-3.5" />
              {savingSchedule ? "Enregistrement…" : "Enregistrer l'horaire"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
