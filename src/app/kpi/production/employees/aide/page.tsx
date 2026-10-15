import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

export default function ProductionEmployeesAidePage() {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Comprendre Prod par employé"
        subtitle="Définitions, formules et exemples pour lire chaque colonne sans ambiguïté."
      />
      <p className="mb-8">
        <Link href="/kpi/production/employees" className="text-sm text-primary hover:underline">
          ← Retour à Prod par employé
        </Link>
      </p>

      <section className="space-y-3 mb-10">
        <h2 className="text-base font-semibold text-slate-900">Périmètre du KPI</h2>
        <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li>
            Seuls les <strong>BOM solo</strong> (une seule personne sur le BOM) entrent dans le rendement.
          </li>
          <li>
            Les punches exclus (trop lent / trop rapide / sans standard / qty 0) ne comptent ni en réel ni en cible.
          </li>
          <li>
            Les <strong>BOM équipe</strong> ne sont pas dans Vous % ni Moy. équipe % — ils servent plutôt à calibrer les futurs standards (voir plus bas).
          </li>
        </ul>
      </section>

      <section className="space-y-4 mb-10">
        <h2 className="text-base font-semibold text-slate-900">Colonnes du détail item</h2>

        <DocBlock
          title="Réel"
          body="Somme des minutes passées par l’employé sur cet item (BOM solo inclus)."
        />
        <DocBlock
          title="Cible"
          body="Standard × unités pour les mêmes punches. Cible = quantité × minutes_standard_par_unité."
        />
        <DocBlock
          title="Écart"
          body="Cible − réel. Négatif = plus lent que le standard. Sert surtout à trier les items les plus coûteux en haut de liste."
        />
        <DocBlock
          title="Réel / u"
          body="Temps moyen par unité : minutes ÷ quantité. C’est le rythme réel de l’employé sur cet item."
        />
        <DocBlock
          title="Cible / u"
          body="Temps unitaire standard de l’item (référence importée). Indépendant du volume produit."
        />
        <DocBlock
          title="Vous %"
          body="Indice de productivité vs le standard : (cible ÷ réel) × 100. ≥ 100 % = dans le standard ou plus rapide ; &lt; 100 % = plus lent."
        />
        <DocBlock
          title="Moy. équipe %"
          body="Même formule (Σ cible ÷ Σ réel) × 100, calculée sur les autres employés qui ont travaillé le même item en BOM solo. Votre temps est exclu. « — » si aucun pair sur la période."
        />
      </section>

      <section className="mb-10 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Exemple chiffré</h2>
        <p className="text-sm text-slate-600 mb-4">
          Item 72.168 — un employé a produit avec 24 h 35 min réel et 9 h 23 min de cible.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Mesure</th>
                <th className="py-2 pr-4">Valeur</th>
                <th className="py-2">Calcul</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 divide-y divide-slate-200">
              <tr>
                <td className="py-2 pr-4 font-medium">Cible</td>
                <td className="py-2 pr-4 tabular-nums">563 min</td>
                <td className="py-2 text-slate-500">9 h 23 min</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Réel</td>
                <td className="py-2 pr-4 tabular-nums">1 475 min</td>
                <td className="py-2 text-slate-500">24 h 35 min</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Vous %</td>
                <td className="py-2 pr-4 tabular-nums font-semibold">38 %</td>
                <td className="py-2 text-slate-500">563 ÷ 1 475 × 100 ≈ 38</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Écart</td>
                <td className="py-2 pr-4 tabular-nums text-primary">−15 h 13 min</td>
                <td className="py-2 text-slate-500">563 − 1 475 = −912 min</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Réel / u</td>
                <td className="py-2 pr-4 tabular-nums">minutes ÷ qty</td>
                <td className="py-2 text-slate-500">rythme réel par pièce</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Cible / u</td>
                <td className="py-2 pr-4 tabular-nums">standard item</td>
                <td className="py-2 text-slate-500">référence importée</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-4">
          Si les pairs sur le même item affichent 70 % en Moy. équipe %, l’écart signale un besoin de formation ciblée
          (et non seulement un standard trop serré).
        </p>
      </section>

      <section className="space-y-3 mb-10">
        <h2 className="text-base font-semibold text-slate-900">Piste — refonte des temps standards</h2>
        <p className="text-sm text-slate-600">
          Objectif métier : recalculer les standards à partir de moyennes sur séries comparables.
        </p>
        <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li>
            <strong>BOM solo</strong> : min/unité attribuable à une personne — base propre pour un nouveau standard.
          </li>
          <li>
            <strong>BOM équipe</strong> : temps unitaire d’équipe = somme des minutes de tous les punchs ÷ quantité.
            Utile pour challenger ou affiner le standard, mais pas pour comparer un employé à ses pairs.
          </li>
          <li>
            Exclure les outliers déjà filtrés par le KPI (trop lent / trop rapide).
          </li>
          <li>
            Livrable futur typique : export analytique + proposition (médiane ou moyenne tronquée), pas un remplacement aveugle.
          </li>
        </ul>
      </section>

      <section className="space-y-3 mb-6">
        <h2 className="text-base font-semibold text-slate-900">Envoyer les données à un analyste (ex. Stéphane)</h2>
        <p className="text-sm text-slate-600">
          TCAP n’a pas encore d’export de masse générique. Pour des calculs externes :
        </p>
        <ol className="text-sm text-slate-600 space-y-2 list-decimal pl-5">
          <li>
            Fournir les <strong>exports sources</strong> SAP / TWMS déjà utilisés à l’import (mêmes fichiers, période claire).
          </li>
          <li>
            Joindre un <strong>dictionnaire des colonnes</strong> (signification, unités, filtres KPI).
          </li>
          <li>
            Préférer les données brutes aux agrégats KPI — l’analyste pourra recalculer autrement.
          </li>
          <li>
            Optionnel plus tard : export CSV depuis Supabase (
            <code className="text-xs bg-slate-100 px-1 rounded">production_log_lines</code>,{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">production_standards</code>,{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">picking_daily_counts</code>, logs S8…).
          </li>
        </ol>
      </section>
    </div>
  );
}

function DocBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-sm text-slate-600 mt-1">{body}</p>
    </div>
  );
}
