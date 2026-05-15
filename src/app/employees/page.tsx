"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, UserCheck, UserX, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Employee, EmployeeInsert } from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { formatDateFr } from "@/lib/utils";
import { cn } from "@/lib/utils";

type ModalMode = "create" | "edit" | "deactivate";

export default function EmployeesPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [form, setForm] = useState({ full_name: "" });
  const [deactivateDate, setDeactivateDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("employees")
      .select("*")
      .order("full_name");
    setEmployees(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setModalMode("create");
    setEditTarget(null);
    setForm({ full_name: "" });
    setModalOpen(true);
  }

  function openEdit(emp: Employee) {
    setModalMode("edit");
    setEditTarget(emp);
    setForm({ full_name: emp.full_name });
    setModalOpen(true);
  }

  function openDeactivate(emp: Employee) {
    setModalMode("deactivate");
    setEditTarget(emp);
    setDeactivateDate(new Date().toISOString().slice(0, 10));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.full_name.trim()) return;
    setSaving(true);
    if (modalMode === "edit" && editTarget) {
      await supabase.from("employees").update({ full_name: form.full_name.trim() }).eq("id", editTarget.id);
    } else {
      const insert: EmployeeInsert = { full_name: form.full_name.trim(), is_active: true };
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
    await supabase.from("employees").update({
      is_active: true,
      deactivated_at: null,
    }).eq("id", emp.id);
    load();
  }

  const filtered = employees.filter((e) => {
    if (filter === "active") return e.is_active;
    if (filter === "inactive") return !e.is_active;
    return true;
  });

  const activeCount = employees.filter((e) => e.is_active).length;
  const inactiveCount = employees.filter((e) => !e.is_active).length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Employés"
        subtitle={`${activeCount} actifs · ${inactiveCount} inactifs`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        }
      />

      {/* Filtres */}
      <div className="flex gap-2 mb-5">
        {(["active", "inactive", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            {f === "active" ? `Actifs (${activeCount})` : f === "inactive" ? `Inactifs (${inactiveCount})` : "Tous"}
          </button>
        ))}
      </div>

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Aucun employé</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {filtered.map((emp) => (
            <div key={emp.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                  emp.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                )}>
                  {emp.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className={cn("text-sm font-medium", !emp.is_active && "text-slate-400")}>
                    {emp.full_name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {emp.is_active
                      ? "Actif"
                      : emp.deactivated_at
                        ? `Désactivé le ${formatDateFr(emp.deactivated_at)}`
                        : "Inactif"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(emp)} title="Modifier le nom">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                {emp.is_active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDeactivate(emp)}
                    title="Désactiver avec date"
                    className="text-slate-400 hover:text-orange-600 hover:bg-orange-50"
                  >
                    <UserX className="w-3.5 h-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReactivate(emp)}
                    title="Réactiver"
                    className="text-green-500 hover:bg-green-50"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal créer / modifier nom */}
      <Modal
        open={modalOpen && (modalMode === "create" || modalMode === "edit")}
        onClose={() => setModalOpen(false)}
        title={modalMode === "edit" ? "Modifier l'employé" : "Ajouter un employé"}
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Nom complet"
            value={form.full_name}
            onChange={(e) => setForm({ full_name: e.target.value })}
            placeholder="Ex: Marie Tremblay"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name.trim()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal désactivation avec date */}
      <Modal
        open={modalOpen && modalMode === "deactivate"}
        onClose={() => setModalOpen(false)}
        title="Désactiver l'employé"
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <p className="font-medium mb-1">{editTarget?.full_name}</p>
            <p>L'employé disparaîtra de la vue semaine et des projections à partir de cette date. Les semaines passées resteront visibles dans l'historique.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Date de désactivation
            </label>
            <input
              type="date"
              value={deactivateDate}
              onChange={(e) => setDeactivateDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button variant="danger" onClick={handleDeactivate} disabled={saving || !deactivateDate}>
              {saving ? "Enregistrement…" : "Désactiver"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
