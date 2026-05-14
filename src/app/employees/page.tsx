"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, UserCheck, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Employee, EmployeeInsert } from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export default function EmployeesPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [form, setForm] = useState({ full_name: "" });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("active");

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
    setEditTarget(null);
    setForm({ full_name: "" });
    setModalOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditTarget(emp);
    setForm({ full_name: emp.full_name });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.full_name.trim()) return;
    setSaving(true);
    if (editTarget) {
      await supabase.from("employees").update({ full_name: form.full_name.trim() }).eq("id", editTarget.id);
    } else {
      const insert: EmployeeInsert = { full_name: form.full_name.trim(), is_active: true };
      await supabase.from("employees").insert(insert);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function toggleActive(emp: Employee) {
    await supabase.from("employees").update({ is_active: !emp.is_active }).eq("id", emp.id);
    load();
  }

  const filtered = employees.filter((e) => {
    if (filter === "active") return e.is_active;
    if (filter === "inactive") return !e.is_active;
    return true;
  });

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Employés"
        subtitle={`${employees.filter((e) => e.is_active).length} actifs · ${employees.filter((e) => !e.is_active).length} inactifs`}
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
            {f === "active" ? "Actifs" : f === "inactive" ? "Inactifs" : "Tous"}
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
                    {emp.is_active ? "Actif" : "Inactif"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(emp)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleActive(emp)}
                  title={emp.is_active ? "Désactiver" : "Activer"}
                >
                  {emp.is_active
                    ? <UserX className="w-3.5 h-3.5 text-slate-400" />
                    : <UserCheck className="w-3.5 h-3.5 text-green-500" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? "Modifier l'employé" : "Ajouter un employé"}
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
    </div>
  );
}
