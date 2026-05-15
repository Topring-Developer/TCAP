"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Filter, TrendingUp, TrendingDown, Wand2, AlertCircle } from "lucide-react";
import { addDays, isWeekend, format, eachDayOfInterval, parseISO, getISODay } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  EmployeeAdjustmentWithEmployee,
  EmployeeAdjustmentInsert,
  EmployeeWorkSchedule,
} from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDatetimeFr } from "@/lib/utils";
import { cn } from "@/lib/utils";

type FormState = {
  employee_id: string;
  start_datetime: string;
  end_datetime: string;
  direction: "positive" | "negative" | "";
  notes: string;
};

type GeneratorForm = {
  employee_id: string;
  date_from: string;
  date_to: string;
  am_start: string;
  am_end: string;
  pm_start: string;
  pm_end: string;
  include_weekends: boolean;
  days: Record<number, boolean>; // 1=Lun...7=Dim
  notes: string;
};

const EMPTY_FORM: FormState = {
  employee_id: "", start_datetime: "", end_datetime: "", direction: "", notes: "",
};

const EMPTY_GEN: GeneratorForm = {
  employee_id: "",
  date_from: "",
  date_to: "",
  am_start: "08:00",
  am_end: "12:00",
  pm_start: "13:00",
  pm_end: "17:00",
  include_weekends: false,
  days: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 7: false },
  notes: "",
};

const DAY_NAMES: Record<number, string> = {
  1: "Lun", 2: "Mar", 3: "Mer", 4: "Jeu", 5: "Ven", 6: "Sam", 7: "Dim",
};

export default function AdjustmentsPage() {
  const supabase = createClient();
  const [adjustments, setAdjustments] = useState<EmployeeAdjustmentWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<EmployeeWorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmployeeAdjustmentWithEmployee | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [gen, setGen] = useState<GeneratorForm>(EMPTY_GEN);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatorPreview, setGeneratorPreview] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filtres
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: adjs }, { data: scheds }] = await Promise.all([
      supabase.from("employees").select("*").eq("is_active", true).order("full_name"),
      supabase.from("employee_adjustments").select("*, employees(id, full_name)").order("start_datetime", { ascending: false }),
      supabase.from("employee_work_schedule").select("*"),
    ]);
    setEmployees(emps ?? []);
    setAdjustments((adjs as EmployeeAdjustmentWithEmployee[]) ?? []);
    setSchedules(scheds ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Calcul prévisualisation générateur ─────────────────────
  useEffect(() => {
    if (!gen.date_from || !gen.date_to || !gen.employee_id) {
      setGeneratorPreview([]);
      return;
    }
    try {
      const days = eachDayOfInterval({
        start: parseISO(gen.date_from),
        end: parseISO(gen.date_to),
      }).filter((d) => gen.days[getISODay(d)]);
      setGeneratorPreview(days.map((d) => format(d, "EEE d MMM", { locale: fr })));
    } catch {
      setGeneratorPreview([]);
    }
  }, [gen.date_from, gen.date_to, gen.days]);

  // ─── Remplir les heures depuis l'horaire d'un autre employé ──
  function fillFromSchedule(sourceEmpId: string) {
    const today = new Date();
    const isoDay = Math.min(getISODay(today), 5); // utilise lundi par défaut si we
    const sched = schedules.find((s) => s.employee_id === sourceEmpId && s.weekday === isoDay);
    if (!sched) return;
    setGen((p) => ({
      ...p,
      am_start: sched.am_start?.slice(0, 5) ?? p.am_start,
      am_end: sched.am_end?.slice(0, 5) ?? p.am_end,
      pm_start: sched.pm_start?.slice(0, 5) ?? p.pm_start,
      pm_end: sched.pm_end?.slice(0, 5) ?? p.pm_end,
    }));
  }

  // ─── Générer les ajustements ────────────────────────────────
  async function handleGenerate() {
    if (!gen.employee_id || !gen.date_from || !gen.date_to) return;
    setGenerating(true);

    const days = eachDayOfInterval({
      start: parseISO(gen.date_from),
      end: parseISO(gen.date_to),
    }).filter((d) => gen.days[getISODay(d)]);

    const inserts: EmployeeAdjustmentInsert[] = [];

    for (const day of days) {
      const dateStr = format(day, "yyyy-MM-dd");

      // Bloc AM
      if (gen.am_start && gen.am_end) {
        inserts.push({
          employee_id: gen.employee_id,
          start_datetime: new Date(`${dateStr}T${gen.am_start}:00`).toISOString(),
          end_datetime: new Date(`${dateStr}T${gen.am_end}:00`).toISOString(),
          direction: "positive",
          notes: gen.notes || "Période générée — AM",
          created_by: null,
        });
      }

      // Bloc PM
      if (gen.pm_start && gen.pm_end) {
        inserts.push({
          employee_id: gen.employee_id,
          start_datetime: new Date(`${dateStr}T${gen.pm_start}:00`).toISOString(),
          end_datetime: new Date(`${dateStr}T${gen.pm_end}:00`).toISOString(),
          direction: "positive",
          notes: gen.notes || "Période générée — PM",
          created_by: null,
        });
      }
    }

    // Insérer par lots de 50
    for (let i = 0; i < inserts.length; i += 50) {
      await supabase.from("employee_adjustments").insert(inserts.slice(i, i + 50));
    }

    setGenerating(false);
    setGeneratorOpen(false);
    setGen(EMPTY_GEN);
    load();
  }

  // ─── CRUD simple ────────────────────────────────────────────
  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(adj: EmployeeAdjustmentWithEmployee) {
    setEditTarget(adj);
    setForm({
      employee_id: adj.employee_id,
      start_datetime: adj.start_datetime.slice(0, 16),
      end_datetime: adj.end_datetime.slice(0, 16),
      direction: adj.direction,
      notes: adj.notes ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.employee_id || !form.start_datetime || !form.end_datetime || !form.direction) return;
    setSaving(true);
    const payload: EmployeeAdjustmentInsert = {
      employee_id: form.employee_id,
      start_datetime: new Date(form.start_datetime).toISOString(),
      end_datetime: new Date(form.end_datetime).toISOString(),
      direction: form.direction as "positive" | "negative",
      notes: form.notes || null,
      created_by: null,
    };
    if (editTarget) {
      await supabase.from("employee_adjustments").update(payload).eq("id", editTarget.id);
    } else {
      await supabase.from("employee_adjustments").insert(payload);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    await supabase.from("employee_adjustments").delete().eq("id", id);
    setDeleteConfirm(null);
    load();
  }

  const filtered = adjustments.filter((adj) => {
    if (filterEmployee && adj.employee_id !== filterEmployee) return false;
    if (filterDirection && adj.direction !== filterDirection) return false;
    if (filterDate) {
      const d = new Date(filterDate);
      const start = new Date(adj.start_datetime);
      const end = new Date(adj.end_datetime);
      if (d < start || d > end) return false;
    }
    return true;
  });

  function getDurationHours(start: string, end: string): string {
    const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (m === 0) return `${h}h`;
    return `${h}h${m.toString().padStart(2, "0")}`;
  }

  const fullTimeEmps = employees.filter((e) => e.employment_type === "full_time");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Ajustements"
        subtitle="Retards, overtime, temps repris — et périodes d'horaire temps partiel"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setGen(EMPTY_GEN); setGeneratorOpen(true); }}>
              <Wand2 className="w-4 h-4" /> Générer une période
            </Button>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" /> Ajouter
            </Button>
          </div>
        }
      />

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5 p-4 bg-white rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Filter className="w-4 h-4" /> Filtres
        </div>
        <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700">
          <option value="">Tous les employés</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <select value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700">
          <option value="">Toutes directions</option>
          <option value="positive">Positif (+)</option>
          <option value="negative">Négatif (−)</option>
        </select>
        <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700" />
        {(filterEmployee || filterDirection || filterDate) && (
          <Button variant="ghost" size="sm"
            onClick={() => { setFilterEmployee(""); setFilterDirection(""); setFilterDate(""); }}>
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Aucun ajustement</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 font-semibold text-slate-600">Employé</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Direction</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Début</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Fin</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Durée</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Note</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((adj) => (
                <tr key={adj.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-900">{adj.employees?.full_name}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                      adj.direction === "positive" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"
                    )}>
                      {adj.direction === "positive"
                        ? <><TrendingUp className="w-3 h-3" /> Positif</>
                        : <><TrendingDown className="w-3 h-3" /> Négatif</>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDatetimeFr(adj.start_datetime)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDatetimeFr(adj.end_datetime)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">
                    {getDurationHours(adj.start_datetime, adj.end_datetime)}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{adj.notes ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(adj)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm"
                        onClick={() => setDeleteConfirm(adj.id)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Modal GÉNÉRATEUR DE PÉRIODE ─────────────────────── */}
      <Modal open={generatorOpen} onClose={() => setGeneratorOpen(false)}
        title="Générer une période d'horaire" size="lg">
        <div className="space-y-5">
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800 flex gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>Crée automatiquement des ajustements positifs (AM + PM) pour chaque jour sélectionné. Idéal pour les périodes temps plein d'un employé partiel.</p>
          </div>

          {/* Employé */}
          <Select label="Employé temps partiel"
            value={gen.employee_id}
            onChange={(e) => setGen((p) => ({ ...p, employee_id: e.target.value }))}>
            <option value="">— Sélectionner —</option>
            {employees.filter((e) => e.employment_type === "part_time").map((e) =>
              <option key={e.id} value={e.id}>{e.full_name}</option>
            )}
          </Select>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Période — début" type="date" value={gen.date_from}
              onChange={(e) => setGen((p) => ({ ...p, date_from: e.target.value }))} />
            <Input label="Période — fin" type="date" value={gen.date_to}
              onChange={(e) => setGen((p) => ({ ...p, date_to: e.target.value }))} />
          </div>

          {/* Jours de la semaine */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Jours travaillés</p>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} type="button"
                  onClick={() => setGen((p) => ({ ...p, days: { ...p.days, [d]: !p.days[d] } }))}
                  className={cn(
                    "w-12 py-2 rounded-lg text-xs font-semibold border-2 transition-colors",
                    gen.days[d]
                      ? d <= 5 ? "border-blue-500 bg-blue-50 text-blue-700" : "border-orange-400 bg-orange-50 text-orange-700"
                      : "border-slate-200 text-slate-400"
                  )}>
                  {DAY_NAMES[d]}
                </button>
              ))}
            </div>
          </div>

          {/* Heures — avec option copier d'un employé temps plein */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">Blocs horaires</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Copier l'horaire de :</span>
                <select
                  onChange={(e) => e.target.value && fillFromSchedule(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white text-slate-700"
                  defaultValue="">
                  <option value="">— Choisir —</option>
                  {fullTimeEmps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {([["am_start", "AM début"], ["am_end", "AM fin"], ["pm_start", "PM début"], ["pm_end", "PM fin"]] as const).map(([field, label]) => (
                <div key={field}>
                  <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                  <input type="time" value={gen[field]}
                    onChange={(e) => setGen((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
            </div>
          </div>

          {/* Note */}
          <Input label="Note (optionnel)"
            value={gen.notes}
            onChange={(e) => setGen((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Ex: Période été 2026 — horaire temps plein" />

          {/* Prévisualisation */}
          {generatorPreview.length > 0 && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-xs font-semibold text-slate-600 mb-2">
                {generatorPreview.length} jour{generatorPreview.length > 1 ? "s" : ""} sélectionné{generatorPreview.length > 1 ? "s" : ""}
                {" → "}{generatorPreview.length * ((gen.am_start && gen.am_end ? 1 : 0) + (gen.pm_start && gen.pm_end ? 1 : 0))} ajustements à créer
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {generatorPreview.map((d) => (
                  <span key={d} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-600">{d}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setGeneratorOpen(false)}>Annuler</Button>
            <Button
              onClick={handleGenerate}
              disabled={generating || !gen.employee_id || !gen.date_from || !gen.date_to || generatorPreview.length === 0}>
              <Wand2 className="w-4 h-4" />
              {generating ? `Génération… (${generatorPreview.length} jours)` : `Générer ${generatorPreview.length} jour${generatorPreview.length > 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal formulaire simple */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editTarget ? "Modifier l'ajustement" : "Ajouter un ajustement"} size="md">
        <div className="space-y-4">
          <Select label="Employé" value={form.employee_id}
            onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))}>
            <option value="">— Sélectionner —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Direction</p>
            <div className="grid grid-cols-2 gap-3">
              {(["positive", "negative"] as const).map((d) => (
                <button key={d} type="button"
                  onClick={() => setForm((p) => ({ ...p, direction: d }))}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-colors",
                    form.direction === d
                      ? d === "positive" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  )}>
                  {d === "positive" ? <><TrendingUp className="w-4 h-4" /> Positif (+)</> : <><TrendingDown className="w-4 h-4" /> Négatif (−)</>}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Début" type="datetime-local" value={form.start_datetime}
              onChange={(e) => setForm((p) => ({ ...p, start_datetime: e.target.value }))} />
            <Input label="Fin" type="datetime-local" value={form.end_datetime}
              onChange={(e) => setForm((p) => ({ ...p, end_datetime: e.target.value }))} />
          </div>
          <Input label="Note (optionnel)" value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Ex: Arrivée 1h en retard — reprend demain" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave}
              disabled={saving || !form.employee_id || !form.start_datetime || !form.end_datetime || !form.direction}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal suppression */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}
        title="Supprimer l'ajustement" size="sm">
        <p className="text-sm text-slate-600 mb-5">Êtes-vous sûr ? Cette action est irréversible.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Annuler</Button>
          <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Supprimer</Button>
        </div>
      </Modal>
    </div>
  );
}
