"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle2, XCircle, AlertCircle, Database } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type ImportBatch = {
  id: string;
  import_type: string;
  source_system: string;
  period_start: string;
  period_end: string;
  imported_by: string | null;
  imported_at: string;
  file_name: string | null;
  row_count: number | null;
  status: "pending" | "processing" | "completed" | "failed";
  notes: string | null;
};

const STATUS_CONFIG = {
  pending:    { label: "En attente",    color: "bg-amber-100 text-amber-700",  icon: AlertCircle },
  processing: { label: "En cours",      color: "bg-blue-100 text-blue-700",    icon: RefreshCw },
  completed:  { label: "Complété",      color: "bg-green-100 text-green-700",  icon: CheckCircle2 },
  failed:     { label: "Échoué",        color: "bg-red-100 text-red-700",      icon: XCircle },
};

const IMPORT_TYPE_LABELS: Record<string, string> = {
  S8_TIME_LOGS:         "S8 — Logs de temps",
  S8_PRODUCTION:        "S8 — Production",
  SAP_PICKING:          "SAP — Picking",
  SAP_PACKING:          "SAP — Emballage",
  SAP_RECEIPTS:         "SAP — Réceptions",
  SAP_RECEIVING:        "SAP — Réception (agrégé)",
  SAP_INVENTORY:        "SAP — Inventaire cyclique",
  SAP_PRERECEPTIONS:    "SAP — Pré-réceptions",
  PRODUCTION_STANDARDS: "Standards de production",
};

export default function ValidationPage() {
  const supabase = createClient();
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [unmappedEmployees, setUnmappedEmployees] = useState(0);
  const [unmappedTasks, setUnmappedTasks] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: b }, { data: unmEmp }, { data: unmTask }] = await Promise.all([
      supabase.from("import_batches").select("*").order("imported_at", { ascending: false }).limit(50),
      supabase.from("s8_time_logs").select("id").is("employee_id", null).limit(1),
      supabase.from("s8_time_logs").select("id").is("task_mapping_id", null).limit(1),
    ]);
    setBatches((b as ImportBatch[]) ?? []);
    setUnmappedEmployees(unmEmp?.length ?? 0);
    setUnmappedTasks(unmTask?.length ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const alerts = [
    { icon: AlertCircle, label: "Employés non mappés dans S8", value: unmappedEmployees, href: "/admin/mapping-employees", color: unmappedEmployees > 0 ? "text-orange-600" : "text-green-600" },
    { icon: AlertCircle, label: "Tâches non mappées dans S8", value: unmappedTasks, href: "/admin/mapping-tasks", color: unmappedTasks > 0 ? "text-orange-600" : "text-green-600" },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Validation des données"
        subtitle={`${batches.length} imports · Qualité et conformité`}
        actions={<Button variant="secondary" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Actualiser</Button>}
      />

      {/* Alertes qualité */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {alerts.map((a) => {
          const Icon = a.icon;
          return (
            <div key={a.label} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <Icon className={cn("w-5 h-5", a.color)} />
              <div>
                <p className="text-sm font-semibold text-slate-700">{a.label}</p>
                <p className={cn("text-lg font-bold", a.color)}>{a.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Liste des imports */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 flex items-center gap-2 border-b border-slate-200">
          <Database className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">Historique des imports</span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">Chargement…</div>
        ) : batches.length === 0 ? (
          <div className="text-center py-12">
            <Database className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">Aucun import pour le moment</p>
            <p className="text-sm text-slate-400 mt-1">
              Les imports apparaîtront ici une fois l&apos;interface d&apos;import activée (Phase 2).
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_80px_80px] gap-4 px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <span>Type</span><span>Période</span><span>Importé par</span><span>Fichier</span><span className="text-center">Lignes</span><span className="text-center">Statut</span>
            </div>
            {batches.map((b) => {
              const s = STATUS_CONFIG[b.status];
              const StatusIcon = s.icon;
              return (
                <div key={b.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_80px_80px] gap-4 items-center px-5 py-3 hover:bg-slate-50 text-sm">
                  <span className="font-medium text-slate-900">{IMPORT_TYPE_LABELS[b.import_type] ?? b.import_type}</span>
                  <span className="text-slate-500">{b.period_start} → {b.period_end}</span>
                  <span className="text-slate-500">{b.imported_by ?? "—"}</span>
                  <span className="text-slate-500 truncate">{b.file_name ?? "—"}</span>
                  <span className="text-center text-slate-600">{b.row_count ?? "—"}</span>
                  <span className={cn("flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1 rounded-full", s.color)}>
                    <StatusIcon className="w-3 h-3" /> {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
