"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, Circle, Clock, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

/** Premier mois suivi dans le registre (pas de données avant) */
const REGISTER_START = "2026-04";

/** Mois du plus récent au plus ancien, à partir de REGISTER_START */
function buildMonthRangeFrom(startYm: string): string[] {
  const now = new Date();
  const months: string[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  while (true) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym < startYm) break;
    months.push(ym);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return months;
}

function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Pour TWMS : un mois M est "en attente" si la période de paye qui
 * couvre la fin de M n'est pas encore fermée. On considère qu'il faut
 * attendre 21 jours dans le mois suivant (2 cycles de paie bimensuels
 * peuvent couvrir la fin de mois). C'est une heuristique — l'utilisateur
 * est juge final.
 */
function twmsMonthStatus(ym: string, importedSet: Set<string>): "imported" | "waiting" | "missing" {
  if (importedSet.has(ym)) return "imported";
  const [y, m] = ym.split("-").map(Number);
  const monthEndPlusThreshold = new Date(y!, m!, 21); // 21 du mois suivant
  const now = new Date();
  if (now < monthEndPlusThreshold) return "waiting";
  return "missing";
}

type SourceStatus = "imported" | "waiting" | "missing";

type MonthRow = {
  month: string;
  twms: SourceStatus;
  picking: SourceStatus;
  packaging: SourceStatus;
  receiving: SourceStatus;
  production: SourceStatus;
  inventory: SourceStatus;
};

const SOURCES: { key: keyof MonthRow; label: string; href: string }[] = [
  { key: "twms",       label: "TWMS (S8)",     href: "/admin/import" },
  { key: "picking",    label: "Picking SAP",   href: "/admin/import/picking" },
  { key: "packaging",  label: "Emballage SAP", href: "/admin/import/packaging" },
  { key: "receiving",  label: "Réception SAP", href: "/admin/import/receiving" },
  { key: "production", label: "Production SAP",href: "/admin/import/production" },
  { key: "inventory",  label: "Inventaire SAP",href: "/admin/import/inventory" },
];

export default function ImportRegisterPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Mois à afficher : d'avril 2026 jusqu'au mois courant
    const months = buildMonthRangeFrom(REGISTER_START);
    const currentMonth = months[0]!;

    /**
     * Existence par mois (count head) — pas un select massif.
     * Avant : on chargeait toutes les log_date (plafond PostgREST = 1000),
     * donc seul juillet apparaissait et avril–juin semblaient manquants.
     */
    async function monthsPresentByDate(
      table: string,
      dateCol: string
    ): Promise<Set<string>> {
      const checks = await Promise.all(
        months.map(async (ym) => {
          const { start, end } = monthBounds(ym);
          const { count } = await supabase
            .from(table)
            .select("id", { count: "exact", head: true })
            .gte(dateCol, start)
            .lte(dateCol, end);
          return (count ?? 0) > 0 ? ym : null;
        })
      );
      return new Set(checks.filter((x): x is string => x !== null));
    }

    async function monthsPresentByPeriod(table: string): Promise<Set<string>> {
      const checks = await Promise.all(
        months.map(async (ym) => {
          const { count } = await supabase
            .from(table)
            .select("id", { count: "exact", head: true })
            .eq("period_month", ym);
          return (count ?? 0) > 0 ? ym : null;
        })
      );
      return new Set(checks.filter((x): x is string => x !== null));
    }

    const [twmsMonths, pickMonths, packMonths, recvMonths, prodMonths, invMonths] =
      await Promise.all([
        monthsPresentByDate("s8_time_logs", "log_date"),
        monthsPresentByPeriod("picking_daily_counts"),
        monthsPresentByPeriod("packaging_daily_counts"),
        monthsPresentByPeriod("receiving_daily_counts"),
        monthsPresentByPeriod("production_actuals"),
        monthsPresentByPeriod("inventory_count_lines"),
      ]);

    const result: MonthRow[] = months.map((m) => {
      const isCurrent = m === currentMonth;
      const simpleStatus = (set: Set<string>): SourceStatus =>
        set.has(m) ? "imported" : isCurrent ? "waiting" : "missing";

      return {
        month: m,
        twms: twmsMonthStatus(m, twmsMonths),
        picking: simpleStatus(pickMonths),
        packaging: simpleStatus(packMonths),
        receiving: simpleStatus(recvMonths),
        production: simpleStatus(prodMonths),
        inventory: simpleStatus(invMonths),
      };
    });

    setRows(result);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentRow = rows[0];
  const pendingForCurrent = currentRow
    ? SOURCES.filter((s) => (currentRow[s.key] as SourceStatus) !== "imported")
    : [];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Registre des imports"
        subtitle="Suivi par mois · sources SAP et TWMS"
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </Button>
        }
      />

      {/* Note TWMS */}
      <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm">
        <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-amber-800">
          <p className="font-semibold mb-0.5">Logs TWMS — attente confirmation paye</p>
          <p className="text-xs text-amber-700">
            Les logs S8 doivent être validés avec Nethris avant d&apos;être importés.
            Puisque les périodes de paye (14 jours) ne s&apos;alignent pas avec les fins de mois,
            il faut attendre que les deux cycles couvrant la fin du mois soient fermés
            avant d&apos;importer un mois complet.
            Les derniers jours d&apos;un mois (ex: 1–4 août) ne font pas partie du mois précédent.
          </p>
        </div>
      </div>

      {/* Mois courant — todo */}
      {currentRow && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-slate-700 mb-3">
            Mois courant — {monthLabel(currentRow.month)}
            {pendingForCurrent.length === 0 && (
              <span className="ml-2 text-green-600 font-normal text-xs">Tout importé ✓</span>
            )}
          </p>
          {pendingForCurrent.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {pendingForCurrent.map((s) => (
                <Link
                  key={s.key}
                  href={s.href}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 hover:border-primary/40 transition-colors"
                >
                  {currentRow[s.key] === "waiting"
                    ? <Clock className="w-3.5 h-3.5 text-amber-500" />
                    : <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  }
                  {s.label}
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Aucune action requise pour ce mois.</p>
          )}
        </div>
      )}

      {/* Matrice */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">Chargement…</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide w-28">
                    Mois
                  </th>
                  {SOURCES.map((s) => (
                    <th key={s.key} className="text-center px-3 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                      <Link href={s.href} className="hover:text-primary hover:underline transition-colors">
                        {s.label}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, i) => {
                  const isCurrent = i === 0;
                  const allImported = SOURCES.every(
                    (s) => (row[s.key] as SourceStatus) === "imported"
                  );
                  return (
                    <tr
                      key={row.month}
                      className={cn(
                        "hover:bg-slate-50 transition-colors",
                        isCurrent && "bg-primary/5 hover:bg-primary/5"
                      )}
                    >
                      <td className="px-5 py-3 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          {isCurrent && (
                            <span className="text-[10px] font-bold bg-primary text-white px-1.5 py-0.5 rounded">
                              EN COURS
                            </span>
                          )}
                          {!isCurrent && allImported && (
                            <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                              ✓
                            </span>
                          )}
                          {monthLabel(row.month)}
                        </div>
                      </td>
                      {SOURCES.map((s) => {
                        const status = row[s.key] as SourceStatus;
                        return (
                          <td key={s.key} className="px-3 py-3 text-center">
                            {status === "imported" ? (
                              <Link
                                href={s.href}
                                title={`Remplacer / vérifier ${s.label} pour ${monthLabel(row.month)}`}
                                className="group inline-flex flex-col items-center gap-0.5"
                              >
                                <CheckCircle2 className="w-5 h-5 text-green-500 group-hover:text-green-600" />
                                <span className="text-[10px] text-slate-300 group-hover:text-primary transition-colors leading-none">
                                  remplacer
                                </span>
                              </Link>
                            ) : (
                              <Link href={s.href} title={`Importer ${s.label} pour ${monthLabel(row.month)}`}>
                                <StatusIcon status={status} />
                              </Link>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Légende */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Importé
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> En attente / mois courant
            </span>
            <span className="flex items-center gap-1.5">
              <Circle className="w-3.5 h-3.5 text-red-400" /> Manquant
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: SourceStatus }) {
  if (status === "imported") {
    return <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />;
  }
  if (status === "waiting") {
    return <Clock className="w-5 h-5 text-amber-400 mx-auto" />;
  }
  return <Circle className="w-5 h-5 text-red-300 mx-auto" />;
}
