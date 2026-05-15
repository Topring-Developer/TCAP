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

type FilterStatus = "active" | "inactive" | "all";
type ModalMode = "create" | "edit" | "deactivate";

const EMPLOYMENT_LABELS = {
  full_time: { label: "Temps plein", color: "bg-green-100 text-green-700" },
  part_time: { label: "Temps partiel", color: "bg-purple-100 text-purple-700" },
};

export default function EmployeesPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [form, setForm] = useState({ full_name: "", employment_type: "full_time" as "full_time" | "part_time" });
  const [deactivateDate, setDeactivateDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("active");
  const [filterType, setFilterType] = useState<"all" | "full_time" | "part_time">("all");

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("employees").select("*").order("full_name");
    setEmployees(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setModalMode("create");
    setEditTarget(null);
    setForm({ full_name: "", employment_type: "full_time" });
    setModalOpen(true);
  }

  function openEdit(emp: Employee) {
    setModalMode("edit");
    setEditTarget(emp);
    setForm({ full_name: emp.full_name, employment_type: emp.employment_type });
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
      await supabase.from("employees").update({
        full_name: form.full_name.trim(),
        employment_type: form.employment_type,
      }).eq("id", editTarget.id);
    } else {
      const insert: EmployeeInsert = {
        full_name: form.full_name.trim(),
        is_active: true,
        employment_type: form.employment_type,
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

  const filtered = employees.filter((e) => {
    const statusOk = filterStatus === "all" || (filterStatus === "active" ? e.is_active : !e.is_active);
    const typeOk = filterType === "all" || e.employment_type === filterType;
    return statusOk && typeOk;
  });

  const activeCount = employees.filter((e) => e.is_active).length;
  const inactiveCount = employees.filter((e) => !e.is_active).length;
  const fullTimeCount = employees.filter((e) => e.is_active && e.employment_type === "full_time").length;
  const partTimeCount = employees.filter((e) => e.is_active && e.employment_type === "part_time").length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Employés"
        subtitle={`${activeCount} actifs · ${fullTimeCount} temps plein · ${partTimeCount} temps partiel · ${inactiveCount} inactifs`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        }
      />

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Statut */}
        <div className="flex gap-1.5">
          {(["active", "inactive", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filterStatus === f
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {f === "active" ? `Actifs (${activeCount})` : f === "inactive" ? `Inactifs (${inactiveCount})` : "Tous"}
            </button>
          ))}
        </div>

        {/* Type */}
        <div className="flex gap-1.5">
          {(["all", "full_time", "part_time"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filterType === t
                  ? "bg-slate-800 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
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
            const typeInfo = EMPLOYMENT_LABELS[emp.employment_type] ?? EMPLOYMENT_LABELS.full_time;
            return (
              <div key={emp.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                    emp.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                  )}>
                    {emp.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-medium", !emp.is_active && "text-slate-400")}>
                        {emp.full_name}
                      </p>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", typeInfo.color)}>
                        {typeInfo.label}
                      </span>
                    </div>
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
                  <Button variant="ghost" size="sm" onClick={() => openEdit(emp)} title="Modifier">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {emp.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeactivate(emp)}
                      title="Désactiver"
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
            );
          })}
        </div>
      )}

      {/* Modal créer / modifier */}
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
            onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Ex: Marie Tremblay"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Type d'emploi</p>
            <div className="grid grid-cols-2 gap-3">
              {(["full_time", "part_time"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, employment_type: t }))}
                  className={cn(
                    "rounded-xl border-2 py-3 text-sm font-semibold transition-colors",
                    form.employment_type === t
                      ? t === "full_time"
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-purple-500 bg-purple-50 text-purple-700"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  )}
                >
                  {t === "full_time" ? "Temps plein" : "Temps partiel"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name.trim()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal désactivation */}
      <Modal
        open={modalOpen && modalMode === "deactivate"}
        onClose={() => setModalOpen(false)}
        title="Désactiver l'employé"
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <p className="font-medium mb-1">{editTarget?.full_name}</p>
            <p>L'employé disparaîtra des projections à partir de cette date. Les semaines passées resteront visibles.</p>
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
