"use client";

import { useEffect, useState, useCallback } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

type TaskMapping = {
  id: string;
  s8_task_name: string;
  kpi_department: string | null;
  kpi_category: string | null;
  is_productive: boolean;
  is_direct_labor: boolean;
  include_in_kpi: boolean;
  notes: string | null;
};

const DEPARTMENTS = ["Picking", "Expédition", "Réception", "Production", "Inventaire", "Support", null];

export default function MappingTasksPage() {
  const supabase = createClient();
  const [tasks, setTasks] = useState<TaskMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TaskMapping | null>(null);
  const [form, setForm] = useState({
    kpi_department: "" as string | null,
    kpi_category: "",
    is_productive: true,
    is_direct_labor: true,
    include_in_kpi: true,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [filterDept, setFilterDept] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("task_mapping").select("*").order("s8_task_name");
    setTasks(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(t: TaskMapping) {
    setEditTarget(t);
    setForm({
      kpi_department: t.kpi_department,
      kpi_category: t.kpi_category ?? "",
      is_productive: t.is_productive,
      is_direct_labor: t.is_direct_labor,
      include_in_kpi: t.include_in_kpi,
      notes: t.notes ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!editTarget) return;
    setSaving(true);
    await supabase.from("task_mapping").update({
      kpi_department: form.kpi_department || null,
      kpi_category: form.kpi_category || null,
      is_productive: form.is_productive,
      is_direct_labor: form.is_direct_labor,
      include_in_kpi: form.include_in_kpi,
      notes: form.notes || null,
    }).eq("id", editTarget.id);
    setSaving(false);
    setModalOpen(false);
    load();
  }

  const deptColor: Record<string, string> = {
    Picking: "bg-blue-100 text-blue-700",
    Expédition: "bg-green-100 text-green-700",
    Réception: "bg-orange-100 text-orange-700",
    Production: "bg-purple-100 text-purple-700",
    Inventaire: "bg-teal-100 text-teal-700",
    Support: "bg-slate-100 text-slate-600",
  };

  const filtered = filterDept === "all" ? tasks :
    filterDept === "unmapped" ? tasks.filter((t) => !t.kpi_department) :
    tasks.filter((t) => t.kpi_department === filterDept);

  const unmappedCount = tasks.filter((t) => !t.kpi_department).length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Mapping — Tâches S8"
        subtitle={`${tasks.length} tâches · ${unmappedCount} sans département`}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </Button>
        }
      />

      {/* Filtres */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {["all", "unmapped", "Picking", "Expédition", "Réception", "Production", "Inventaire", "Support"].map((d) => (
          <button key={d} onClick={() => setFilterDept(d)}
            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              filterDept === d ? "bg-primary text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {d === "all" ? "Tous" : d === "unmapped" ? `Non mappées (${unmappedCount})` : d}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_80px_80px_80px_auto] gap-4 px-5 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Tâche S8</span><span>Département KPI</span><span className="text-center">Productif</span>
            <span className="text-center">Main-d&apos;œuvre</span><span className="text-center">KPI actif</span><span></span>
          </div>
          {filtered.map((t) => (
            <div key={t.id} className="grid grid-cols-[2fr_1fr_80px_80px_80px_auto] gap-4 items-center px-5 py-3 hover:bg-slate-50">
              <span className="text-sm font-medium text-slate-900">{t.s8_task_name}</span>
              <span>
                {t.kpi_department ? (
                  <span className={cn("text-xs font-semibold px-2 py-1 rounded-full", deptColor[t.kpi_department] ?? "bg-slate-100 text-slate-600")}>
                    {t.kpi_department}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">Non mappée</span>
                )}
              </span>
              <span className="text-center text-sm">{t.is_productive ? "✓" : "—"}</span>
              <span className="text-center text-sm">{t.is_direct_labor ? "✓" : "—"}</span>
              <span className={cn("text-center text-xs font-semibold rounded-full px-2 py-1 inline-block",
                t.include_in_kpi ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                {t.include_in_kpi ? "Actif" : "Exclu"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={`Modifier — ${editTarget?.s8_task_name}`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Département KPI</label>
            <select value={form.kpi_department ?? ""} onChange={(e) => setForm((p) => ({ ...p, kpi_department: e.target.value || null }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">— Aucun / Non mappé —</option>
              {DEPARTMENTS.filter(Boolean).map((d) => <option key={d!} value={d!}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">Options</label>
            <div className="space-y-2">
              {[
                { key: "is_productive", label: "Travail productif" },
                { key: "is_direct_labor", label: "Main-d'œuvre directe" },
                { key: "include_in_kpi", label: "Inclure dans les KPI" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form[key as keyof typeof form] as boolean}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary" />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
