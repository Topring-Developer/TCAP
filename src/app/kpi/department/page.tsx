"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

const DEPARTMENTS = ["Picking", "Expédition", "Réception", "Production"];

function DepartmentContent() {
  const params = useSearchParams();
  const dept = params.get("dept") ?? "Picking";

  if (!DEPARTMENTS.includes(dept)) {
    return <p className="text-slate-500">Département inconnu.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link href="/kpi">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900">KPI — {dept}</h1>
          <p className="text-sm text-slate-500">Drill-down par employé</p>
        </div>
      </div>

      {/* Bannière */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Page en construction</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Cette vue détaillée sera disponible après l&apos;import des premières données S8 et SAP.
            Elle affichera les lignes/h par employé avec comparaison historique et détail journalier.
          </p>
        </div>
      </div>

      {/* Structure anticipée */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        {["Vue semaine", "Vue mois", "Vue personnalisée"].map((label) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 opacity-40">
            <p className="text-sm font-semibold text-slate-700">{label}</p>
            <p className="text-xs text-slate-400 mt-1">Disponible après import</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DepartmentKpiPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Suspense fallback={<div className="text-slate-400">Chargement…</div>}>
        <DepartmentContent />
      </Suspense>
    </div>
  );
}
