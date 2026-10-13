"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

const SYSTEMS = ["S8", "SAP", "NETHRIS"] as const;
type SystemName = typeof SYSTEMS[number];

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

type EmpOption = { id: string; full_name: string; is_active: boolean };

type SystemForm = {
  id: string | null;       // null = pas encore créé en BD
  code: string;
  name: string;
  notes: string;
};

const emptySystem = (): SystemForm => ({ id: null, code: "", name: "", notes: "" });

export default function MappingEmployeesPage() {
  const supabase = createClient();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [employees, setEmployees] = useState<EmpOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"active" | "inactive" | "all">("active");
  const [filterMapping, setFilterMapping] = useState<"all" | "incomplete" | "S8" | "SAP" | "NETHRIS">("all");

  // Formulaire employé-centré
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [systems, setSystems] = useState<Record<SystemName, SystemForm>>({
    S8: emptySystem(), SAP: emptySystem(), NETHRIS: emptySystem(),
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: maps }, { data: emps }] = await Promise.all([
      supabase.from("employee_system_mapping").select("*, employees(full_name)").order("system_name"),
      supabase.from("employees").select("id, full_name, is_active").order("full_name"),
    ]);
    setMappings((maps as Mapping[]) ?? []);
    setEmployees((emps as EmpOption[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Quand l'employé sélectionné change dans le modal → charger ses mappings existants
  function loadEmployeeMappings(empId: string) {
    const empMappings = mappings.filter(m => m.employee_id === empId);
    const fresh: Record<SystemName, SystemForm> = {
      S8: emptySystem(), SAP: emptySystem(), NETHRIS: emptySystem(),
    };
    for (const sys of SYSTEMS) {
      const existing = empMappings.find(m => m.system_name === sys);
      if (existing) {
        fresh[sys] = {
          id: existing.id,
          code: existing.external_employee_code ?? "",
          name: existing.external_employee_name ?? "",
          notes: existing.notes ?? "",
        };
      }
    }
    setSystems(fresh);
  }

  function openCreate() {
    const firstEmp = employees[0];
    const empId = firstEmp?.id ?? "";
    setSelectedEmpId(empId);
    if (empId) loadEmployeeMappings(empId);
    else setSystems({ S8: emptySystem(), SAP: emptySystem(), NETHRIS: emptySystem() });
    setModalOpen(true);
  }

  function openEdit(empId: string) {
    setSelectedEmpId(empId);
    loadEmployeeMappings(empId);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!selectedEmpId) return;
    setSaving(true);

    for (const sys of SYSTEMS) {
      const f = systems[sys];
      const hasData = f.code.trim() || f.name.trim() || f.notes.trim();

      if (f.id) {
        // Mise à jour d'un mapping existant
        await supabase.from("employee_system_mapping").update({
          external_employee_code: f.code.trim() || null,
          external_employee_name: f.name.trim() || null,
          notes: f.notes.trim() || null,
        }).eq("id", f.id);
      } else if (hasData) {
        // Créer seulement si des données sont saisies
        await supabase.from("employee_system_mapping").insert({
          employee_id: selectedEmpId,
          system_name: sys,
          external_employee_code: f.code.trim() || null,
          external_employee_name: f.name.trim() || null,
          notes: f.notes.trim() || null,
        });
      }
    }

    setSaving(false);
    setModalOpen(false);
    load();
  }

  function hasSystem(empId: string, sys: SystemName) {
    return mappings.some((m) => m.employee_id === empId && m.system_name === sys && (m.external_employee_name || m.external_employee_code));
  }

  const unmappedCount = employees.filter((e) => !mappings.some((m) => m.employee_id === e.id)).length;
  const missingS8 = employees.filter((e) => e.is_active && !hasSystem(e.id, "S8")).length;

  const filtered = employees.filter((e) => {
    const q = searchQuery.trim().toLowerCase();
    const searchOk =
      !q ||
      e.full_name.toLowerCase().includes(q) ||
      mappings.some(
        (m) =>
          m.employee_id === e.id &&
          ((m.external_employee_name ?? "").toLowerCase().includes(q) ||
            (m.external_employee_code ?? "").toLowerCase().includes(q))
      );
    const statusOk = filterStatus === "all" || (filterStatus === "active" ? e.is_active : !e.is_active);
    const mappedSystems = SYSTEMS.filter((sys) => hasSystem(e.id, sys));
    let mappingOk = true;
    if (filterMapping === "incomplete") mappingOk = mappedSystems.length < SYSTEMS.length;
    else if (filterMapping === "S8" || filterMapping === "SAP" || filterMapping === "NETHRIS") {
      mappingOk = !hasSystem(e.id, filterMapping);
    }
    return searchOk && statusOk && mappingOk;
  });

  const mappedFiltered = filtered.filter((e) => mappings.some((m) => m.employee_id === e.id));
  const unmappedFiltered = filtered.filter((e) => !mappings.some((m) => m.employee_id === e.id));

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Mapping — Employés"
        subtitle={`${employees.length} employés · ${unmappedCount} sans mapping · ${missingS8} actifs sans S8`}
        actions={<Button onClick={openCreate}><Plus className="w-4 h-4" /> Ajouter</Button>}
      />

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Rechercher un nom, un code ou un nom externe…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-slate-400"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex gap-1.5">
          {(["active", "inactive", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filterStatus === f ? "bg-primary text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {f === "active" ? "Actifs" : f === "inactive" ? "Inactifs" : "Tous"}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {([
            { id: "all", label: "Tous mappings" },
            { id: "incomplete", label: "Incomplets" },
            { id: "S8", label: "Sans S8" },
            { id: "SAP", label: "Sans SAP" },
            { id: "NETHRIS", label: "Sans Nethris" },
          ] as const).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterMapping(f.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filterMapping === f.id ? "bg-slate-800 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Aucun employé pour ces filtres</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Employé ({filtered.length})</span>
            <span className="pr-8">Systèmes configurés</span>
          </div>

          {mappedFiltered.map((emp) => {
              const empMaps = mappings.filter((m) => m.employee_id === emp.id);
              const bySystem = Object.fromEntries(empMaps.map((m) => [m.system_name, m]));
              return (
                <div key={emp.id} className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-900">{emp.full_name}</span>
                    {!emp.is_active && <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">inactif</span>}
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    {SYSTEMS.map((sys) => {
                      const m = bySystem[sys];
                      const label = m?.external_employee_name || m?.external_employee_code;
                      return label ? (
                        <span key={sys} className={cn(
                          "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full",
                          sys === "S8"      ? "bg-blue-100 text-blue-700" :
                          sys === "SAP"     ? "bg-green-100 text-green-700" :
                                             "bg-slate-100 text-slate-600"
                        )}>
                          <span className="font-bold">{sys}</span>
                          <span className="font-normal opacity-75">· {label}</span>
                        </span>
                      ) : (
                        <span key={sys} className="inline-flex items-center text-xs text-slate-300 px-2.5 py-1 rounded-full border border-dashed border-slate-200">
                          {sys}
                        </span>
                      );
                    })}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(emp.id)} className="ml-1">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}

          {unmappedFiltered.length > 0 && (
            <>
              <div className="px-5 py-2 bg-amber-50 border-y border-amber-100 text-xs font-semibold text-amber-700 uppercase tracking-wide">
                À configurer — {unmappedFiltered.length} employé(s) sans mapping
              </div>
              {unmappedFiltered.map((emp) => (
                  <div key={emp.id} className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors opacity-70">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{emp.full_name}</span>
                      {!emp.is_active && <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">inactif</span>}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {SYSTEMS.map((sys) => (
                        <span key={sys} className="inline-flex items-center text-xs text-slate-300 px-2.5 py-1 rounded-full border border-dashed border-slate-200">
                          {sys}
                        </span>
                      ))}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(emp.id)} className="ml-1">
                        <Plus className="w-3.5 h-3.5 text-amber-500" />
                      </Button>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      )}

      {/* Modal employé-centré */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title="Mapping employé" size="md">
        <div className="space-y-5">
          {/* Sélection employé */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Employé (TCAP)</label>
            <select
              value={selectedEmpId}
              onChange={(e) => {
                setSelectedEmpId(e.target.value);
                loadEmployeeMappings(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}{!e.is_active ? " (inactif)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Un bloc par système */}
          {SYSTEMS.map((sys) => (
            <div key={sys} className="rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-semibold px-2 py-1 rounded-full",
                  sys === "S8" ? "bg-blue-100 text-blue-700" :
                  sys === "SAP" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")}>
                  {sys}
                </span>
                {systems[sys].id && (
                  <span className="text-xs text-slate-400">mapping existant</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Code externe"
                  value={systems[sys].code}
                  onChange={(e) => setSystems(p => ({ ...p, [sys]: { ...p[sys], code: e.target.value } }))}
                  placeholder="Ex: EMP001"
                />
                <Input
                  label="Nom externe"
                  value={systems[sys].name}
                  onChange={(e) => setSystems(p => ({ ...p, [sys]: { ...p[sys], name: e.target.value } }))}
                  placeholder="Ex: TREMBLAY M."
                />
              </div>
              <Input
                label="Notes"
                value={systems[sys].notes}
                onChange={(e) => setSystems(p => ({ ...p, [sys]: { ...p[sys], notes: e.target.value } }))}
              />
            </div>
          ))}

          <p className="text-xs text-slate-400">
            Seuls les systèmes avec au moins un champ rempli seront créés ou mis à jour.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !selectedEmpId}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
