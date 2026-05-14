"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Filter, TrendingUp, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  EmployeeAdjustmentWithEmployee,
  EmployeeAdjustmentInsert,
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

const EMPTY_FORM: FormState = {
  employee_id: "",
  start_datetime: "",
  end_datetime: "",
  direction: "",
  notes: "",
};

export default function AdjustmentsPage() {
  const supabase = createClient();
  const [adjustments, setAdjustments] = useState<EmployeeAdjustmentWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmployeeAdjustmentWithEmployee | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filtres
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: adjs }] = await Promise.all([
      supabase.from("employees").select("*").eq("is_active", true).order("full_name"),
      supabase
        .from("employee_adjustments")
        .select("*, employees(id, full_name)")
        .order("start_datetime", { ascending: false }),
    ]);
    setEmployees(emps ?? []);
    setAdjustments((adjs as EmployeeAdjustmentWithEmployee[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Ajustements"
        subtitle="Retards, overtime, temps repris — tout ajustement positif ou négatif"
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
          value={filterDirection}
          onChange={(e) => setFilterDirection(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
        >
          <option value="">Toutes directions</option>
          <option value="positive">Positif (+)</option>
          <option value="negative">Négatif (−)</option>
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
        />
        {(filterEmployee || filterDirection || filterDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterEmployee(""); setFilterDirection(""); setFilterDate(""); }}
          >
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
                      adj.direction === "positive"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-orange-50 text-orange-700"
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(adj.id)}
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
        title={editTarget ? "Modifier l'ajustement" : "Ajouter un ajustement"}
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

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Direction</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, direction: "positive" }))}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-colors",
                  form.direction === "positive"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                )}
              >
                <TrendingUp className="w-4 h-4" /> Positif (+)
              </button>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, direction: "negative" }))}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-colors",
                  form.direction === "negative"
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                )}
              >
                <TrendingDown className="w-4 h-4" /> Négatif (−)
              </button>
            </div>
          </div>

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
            placeholder="Ex: Arrivée 1h en retard — reprend demain"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.employee_id || !form.start_datetime || !form.end_datetime || !form.direction}
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
        title="Supprimer l'ajustement"
        size="sm"
      >
        <p className="text-sm text-slate-600 mb-5">
          Êtes-vous sûr de vouloir supprimer cet ajustement ?
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
