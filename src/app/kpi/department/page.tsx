"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

const LINKS = [
  { href: "/kpi/picking", label: "Picking", text: "Lignes et rythme picking." },
  { href: "/kpi/warehouse", label: "Expédition", text: "Picking et emballage, heures d'expédition." },
  { href: "/kpi/receiving", label: "Réception", text: "Lignes SAP et heures de réception." },
  { href: "/kpi/production", label: "Production", text: "Temps réel et temps cible du mois, toute l'équipe." },
  { href: "/kpi/inventory", label: "Inventaire", text: "Lignes comptées et objectif." },
];

export default function DepartmentKpiPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Par département"
        subtitle="Les tableaux déjà en place."
      />
      <div className="grid sm:grid-cols-2 gap-4">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-400 transition-colors"
          >
            <p className="text-sm font-semibold text-slate-900">{link.label}</p>
            <p className="text-xs text-slate-500 mt-1">{link.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
