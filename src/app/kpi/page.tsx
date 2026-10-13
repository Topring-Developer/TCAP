"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Calendar, BarChart3, TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react";
import { addWeeks, subWeeks, format, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type KpiCard = {
  department: string;
  unit: string;
  current: number | null;
  previous: number | null;
  color: string;
  href: string;
};

export default function KpiDashboardPage() {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  const weekLabel = `Semaine du ${format(weekStart, "d MMM yyyy", { locale: fr })}`;

  function variationPct(current: number | null, previous: number | null): number | null {
    if (!current || !previous || previous === 0) return null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  // Données placeholder — seront remplacées par les vraies requêtes Supabase
  const kpis: KpiCard[] = [
    { department: "Picking",    unit: "lignes/h", current: null, previous: null, color: "blue",   href: "/kpi/department?dept=Picking" },
    { department: "Expédition", unit: "lignes/h", current: null, previous: null, color: "green",  href: "/kpi/department?dept=Expédition" },
    { department: "Réception",  unit: "lignes/h", current: null, previous: null, color: "orange", href: "/kpi/department?dept=Réception" },
    { department: "Production", unit: "% standard", current: null, previous: null, color: "purple", href: "/kpi/department?dept=Production" },
  ];

  const colorMap: Record<string, string> = {
    blue:   "border-blue-200 bg-blue-50",
    green:  "border-green-200 bg-green-50",
    orange: "border-orange-200 bg-orange-50",
    purple: "border-purple-200 bg-purple-50",
  };
  const iconColorMap: Record<string, string> = {
    blue: "text-blue-600", green: "text-green-600", orange: "text-orange-600", purple: "text-purple-600",
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard KPI — Performance</h1>
          <p className="text-sm text-slate-500 mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            <Calendar className="w-3.5 h-3.5" /> Aujourd&apos;hui
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => subWeeks(w, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Bannière "données à importer" */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Infrastructure prête — données à importer</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Les tables Supabase sont créées. Pour afficher les KPI, importez d&apos;abord les logs S8 et les volumes SAP,
            puis mappez les employés et les tâches dans la section Administration.
          </p>
        </div>
      </div>

      {/* Cartes KPI par département */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {kpis.map((kpi) => {
          const variation = variationPct(kpi.current, kpi.previous);
          return (
            <div key={kpi.department}
              className={cn("rounded-xl border-2 p-5 cursor-pointer hover:shadow-md transition-shadow", colorMap[kpi.color])}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{kpi.department}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{kpi.unit}</p>
                </div>
                <BarChart3 className={cn("w-5 h-5", iconColorMap[kpi.color])} />
              </div>

              {kpi.current !== null ? (
                <>
                  <p className="text-3xl font-bold text-slate-900">{kpi.current}</p>
                  {variation !== null && (
                    <div className={cn("flex items-center gap-1 mt-2 text-sm font-medium",
                      variation > 0 ? "text-green-600" : variation < 0 ? "text-red-600" : "text-slate-500")}>
                      {variation > 0 ? <TrendingUp className="w-4 h-4" /> :
                       variation < 0 ? <TrendingDown className="w-4 h-4" /> :
                       <Minus className="w-4 h-4" />}
                      {variation > 0 ? "+" : ""}{variation}% vs sem. précédente
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-2xl font-bold text-slate-300">—</p>
                  <p className="text-xs text-slate-400 mt-1">Aucune donnée</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Résumé qualité des données */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Qualité des données — semaine sélectionnée</h3>
        <div className="grid grid-cols-4 gap-4 text-center">
          {[
            { label: "Logs S8 validés", value: "—", sub: "sur 0 logs" },
            { label: "Conformité", value: "—", sub: "seuil: 95%" },
            { label: "Employés non mappés", value: "—", sub: "S8 + SAP" },
            { label: "Tâches non mappées", value: "—", sub: "S8" },
          ].map((item) => (
            <div key={item.label} className="p-3 bg-slate-50 rounded-lg">
              <p className="text-xl font-bold text-slate-400">{item.value}</p>
              <p className="text-xs font-medium text-slate-600 mt-0.5">{item.label}</p>
              <p className="text-xs text-slate-400">{item.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
