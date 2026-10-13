"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type Mapping = {
  id: string;
  employee_id: string;
  system_name: string;
  external_employee_code: string | null;
  external_employee_name: string | null;
  is_active: boolean;
  notes: string | null;
  employees: { full_name: string } | null;
};

const SYSTEMS = ["S8", "SAP", "NETHRIS"];

export default function MappingEmployeesPage() {
  const supabase = createClient();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Mapping | null>(null);
  const [form, setForm] = useState({
    employee_id: "",
    system_name: "S8",
    external_employee_code: "",
    external_employee_name: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [filterSystem, setFilterSystem] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: maps }, { data: emps }] = await Promise.all([
      supabase.from("employee_system_mapping").select("*, employees(full_name)").order("system_name"),
      supabase.from("employees").select("id, full_name").eq("is_active", true).order("full_name"),
    ]);
    setMappings((maps as Mapping[]) ?? []);
    setEmployees(emps ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditTarget(null);
    setForm({ employee_id: employees[0]?.id ?? "", system_name: "S8", external_employee_code: "", external_employee_name: "", notes: "" });
    setModalOpen(true);
  }

  function openEdit(m: Mapping) {
    setEditTarget(m);
    setForm({
      employee_id: m.employee_id,
      system_name: m.system_name,
      external_employee_code: m.external_employee_code ?? "",
      external_employee_name: m.external_employee_name ?? "",
      notes: m.notes ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    const row = {
      employee_id: form.employee_id,
      system_name: form.system_name,
      external_employee_code: form.external_employee_code || null,
      external_employee_name: form.external_employee_name || null,
      notes: form.notes || null,
    };
    if (editTarget) {
      await supabase.from("employee_system_mapping").update(row).eq("id", editTarget.id);
    } else {
      await supabase.from("employee_system_mapping").insert(row);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer ce mapping ?")) return;
    await supabase.from("employee_system_mapping").delete().eq("id", id);
    load();
  }

  const filtered = filterSystem === "all" ? mappings : mappings.filter((m) => m.system_name === filterSystem);
  const unmappedCount = employees.filter((e) => !mappings.find((m) => m.employee_id === e.id && m.system_name === "S8")).length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Mapping — Employés"
        subtitle={`${mappings.length} correspondances · ${unmappedCount} employés sans mapping S8`}
        actions={<Button onClick={openCreate}><Plus className="w-4 h-4" /> Ajouter</Button>}
      />

      {/* Filtres système */}
      <div className="flex gap-1.5 mb-5">
        {["all", ...SYSTEMS].map((s) => (
          <button key={s} onClick={() => setFilterSystem(s)}
            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              filterSystem === s ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {s === "all" ? "Tous" : s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Aucune correspondance</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_1fr_1fr_auto] gap-4 px-5 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Employé (TCAP)</span><span>Système</span><span>Code externe</span><span>Nom externe</span><span></span>
          </div>
          {filtered.map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_80px_1fr_1fr_auto] gap-4 items-center px-5 py-3 hover:bg-slate-50">
              <span className="text-sm font-medium text-slate-900">{m.employees?.full_name ?? "—"}</span>
              <span className={cn("text-xs font-semibold px-2 py-1 rounded-full inline-block text-center",
                m.system_name === "S8" ? "bg-blue-100 text-blue-700" :
                m.system_name === "SAP" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")}>
                {m.system_name}
              </span>
              <span className="text-sm text-slate-600">{m.external_employee_code ?? "—"}</span>
              <span className="text-sm text-slate-600">{m.external_employee_name ?? "—"}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(m)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}
                  className="text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editTarget ? "Modifier le mapping" : "Ajouter un mapping"} size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Employé (TCAP)</label>
            <select value={form.employee_id} onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Système</label>
            <div className="flex gap-2">
              {SYSTEMS.map((s) => (
                <button key={s} type="button" onClick={() => setForm((p) => ({ ...p, system_name: s }))}
                  className={cn("flex-1 py-2 rounded-lg border-2 text-sm font-semibold transition-colors",
                    form.system_name === s ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Input label="Code externe" value={form.external_employee_code}
            onChange={(e) => setForm((p) => ({ ...p, external_employee_code: e.target.value }))}
            placeholder="Ex: EMP001" />
          <Input label="Nom externe (tel qu'affiché dans le système)" value={form.external_employee_name}
            onChange={(e) => setForm((p) => ({ ...p, external_employee_name: e.target.value }))}
            placeholder="Ex: TREMBLAY M." />
          <Input label="Notes" value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.employee_id}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
