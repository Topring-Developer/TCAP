"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  ExclusionType,
  EmployeeExclusionWithType,
  EmployeeExclusionInsert,
} from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { formatDatetimeFr } from "@/lib/utils";
import { cn } from "@/lib/utils";

type FormState = {
  employee_id: string;
  exclusion_type_id: string;
  start_datetime: string;
  end_datetime: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  employee_id: "",
  exclusion_type_id: "",
  start_datetime: "",
  end_datetime: "",
  notes: "",
};

export default function ExclusionsPage() {
  const supabase = createClient();
  const [exclusions, setExclusions] = useState<EmployeeExclusionWithType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<ExclusionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmployeeExclusionWithType | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filtres
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: excTypes }, { data: excs }] = await Promise.all([
      supabase.from("employees").select("*").eq("is_active", true).order("full_name"),
      supabase.from("exclusion_types").select("*").eq("is_active", true).order("label"),
      supabase
        .from("employee_exclusions")
        .select("*, exclusion_types(*), employees(id, full_name)")
        .order("start_datetime", { ascending: false }),
    ]);
    setEmployees(emps ?? []);
    setTypes(excTypes ?? []);
    setExclusions((excs as EmployeeExclusionWithType[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(ex: EmployeeExclusionWithType) {
    setEditTarget(ex);
    setForm({
      employee_id: ex.employee_id,
      exclusion_type_id: ex.exclusion_type_id,
      start_datetime: ex.start_datetime.slice(0, 16),
      end_datetime: ex.end_datetime.slice(0, 16),
      notes: ex.notes ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.employee_id || !form.exclusion_type_id || !form.start_datetime || !form.end_datetime) return;
    setSaving(true);
    const payload: EmployeeExclusionInsert = {
      employee_id: form.employee_id,
      exclusion_type_id: form.exclusion_type_id,
      start_datetime: new Date(form.start_datetime).toISOString(),
      end_datetime: new Date(form.end_datetime).toISOString(),
      notes: form.notes || null,
      created_by: null,
    };
    if (editTarget) {
      await supabase.from("employee_exclusions").update(payload).eq("id", editTarget.id);
    } else {
      await supabase.from("employee_exclusions").insert(payload);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    await supabase.from("employee_exclusions").delete().eq("id", id);
    setDeleteConfirm(null);
    load();
  }

  const filtered = exclusions.filter((ex) => {
    if (filterEmployee && ex.employee_id !== filterEmployee) return false;
    if (filterType && ex.exclusion_type_id !== filterType) return false;
    if (filterDate) {
      const d = new Date(filterDate);
      const start = new Date(ex.start_datetime);
      const end = new Date(ex.end_datetime);
      if (d < start || d > end) return false;
    }
    return true;
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Exclusions"
        subtitle="Absences, vacances, congés et autres exclusions de capacité"
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        }
      />

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5 p-4 bg-white rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Filter className="w-4 h-4" /> Filtres
        </div>
        <select
          value={filterEmployee}
          onChange={(e) => setFilterEmployee(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
        >
          <option value="">Tous les employés</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
        >
          <option value="">Tous les types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
          placeholder="Date"
        />
        {(filterEmployee || filterType || filterDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterEmployee(""); setFilterType(""); setFilterDate(""); }}
          >
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Aucune exclusion</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 font-semibold text-slate-600">Employé</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Début</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Fin</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Note</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-900">{ex.employees?.full_name}</td>
                  <td className="px-4 py-3">
                    <Badge color={ex.exclusion_types?.color ?? undefined}>
                      {ex.exclusion_types?.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDatetimeFr(ex.start_datetime)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDatetimeFr(ex.end_datetime)}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{ex.notes ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(ex)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(ex.id)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50"
                      >
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

      {/* Modal formulaire */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? "Modifier l'exclusion" : "Ajouter une exclusion"}
        size="md"
      >
        <div className="space-y-4">
          <Select
            label="Employé"
            value={form.employee_id}
            onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))}
          >
            <option value="">— Sélectionner —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>

          <Select
            label="Type d'exclusion"
            value={form.exclusion_type_id}
            onChange={(e) => setForm((p) => ({ ...p, exclusion_type_id: e.target.value }))}
          >
            <option value="">— Sélectionner —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Début"
              type="datetime-local"
              value={form.start_datetime}
              onChange={(e) => setForm((p) => ({ ...p, start_datetime: e.target.value }))}
            />
            <Input
              label="Fin"
              type="datetime-local"
              value={form.end_datetime}
              onChange={(e) => setForm((p) => ({ ...p, end_datetime: e.target.value }))}
            />
          </div>

          <Input
            label="Note (optionnel)"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Ex: Rendez-vous médical"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.employee_id || !form.exclusion_type_id || !form.start_datetime || !form.end_datetime}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer l'exclusion"
        size="sm"
      >
        <p className="text-sm text-slate-600 mb-5">
          Êtes-vous sûr de vouloir supprimer cette exclusion ? Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Annuler</Button>
          <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
            Supprimer
          </Button>
        </div>
      </Modal>
    </div>
  );
}
