"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductionDrillModal } from "@/components/kpi/ProductionDrillModal";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  EXCLUSION_LABELS,
  type ExclusionReason,
  type FocusItem,
  type PersonExclusion,
  type PersonProductionRow,
  type PersonSlice,
  buildPersonSlices,
  extractSeries,
  formatMinutes,
  formatUnitMinutes,
  normalizeBom,
  soloBomIds,
  summarizePeople,
  teamStatsByItem,
} from "@/lib/production";

type LogLine = {
  id: string;
  id_sap: string;
  itemcode: string;
  bom: string | null;
  quantity: number;
  duration_minutes: number | null;
  period_month: string;
  timestamp_begin: string | null;
  timestamp_end: string | null;
};

const MONTH_LABELS: Record<string, string> = {
  "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
  "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
  "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

const LAST_12 = "last-12";

function fmtSigned(minutes: number): string {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "";
  return `${sign}${formatMinutes(Math.abs(minutes))}`;
}

async function fetchOwners(
  supabase: ReturnType<typeof createClient>,
  boms: string[]
): Promise<{ bom: string | null; id_sap: string }[]> {
  const rows: { bom: string | null; id_sap: string }[] = [];
  const chunkSize = 80;
  for (let i = 0; i < boms.length; i += chunkSize) {
    const chunk = boms.slice(i, i + chunkSize);
    const { data } = await fetchAllRows<{ bom: string | null; id_sap: string }>((from, to) =>
      supabase.from("production_log_lines").select("bom, id_sap").in("bom", chunk).range(from, to)
    );
    rows.push(...data);
  }
  return rows;
}

export default function ProductionEmployeesPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [standards, setStandards] = useState<Map<string, number>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusItem | null>(null);

  const loadMonths = useCallback(async () => {
    const { data } = await fetchAllRows<{ period_month: string }>((from, to) =>
      supabase
        .from("production_log_lines")
        .select("period_month")
        .order("period_month", { ascending: false })
        .range(from, to)
    );
    const unique = [...new Set(data.map((r) => r.period_month))].sort().reverse();
    setMonths(unique);
    setSelectedMonth((cur) => cur || unique[0] || "");
  }, []);

  const loadPeriod = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);
    setOpenId(null);

    const isLast12 = selectedMonth === LAST_12;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let periodFilter: (q: any) => any;
    if (isLast12) {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
      periodFilter = (q) => q.gte("period_month", cutoffMonth);
    } else {
      periodFilter = (q) => q.eq("period_month", selectedMonth);
    }

    const [{ data: logData }, { data: stdRows }, { data: mappingData }] = await Promise.all([
      fetchAllRows<LogLine>((from, to) =>
        periodFilter(
          supabase
            .from("production_log_lines")
            .select("id, id_sap, itemcode, bom, quantity, duration_minutes, period_month, timestamp_begin, timestamp_end")
        ).range(from, to)
      ),
      fetchAllRows<{ item_code: string; standard_minutes_per_unit: number }>((from, to) =>
        supabase.from("production_standards").select("item_code, standard_minutes_per_unit").range(from, to)
      ),
      fetchAllRows<{
        external_employee_code: string | null;
        employees: { full_name: string } | { full_name: string }[] | null;
      }>((from, to) =>
        supabase
          .from("employee_system_mapping")
          .select("external_employee_code, employees(full_name)")
          .eq("system_name", "SAP")
          .eq("is_active", true)
          .range(from, to)
      ),
    ]);

    const boms = [...new Set(logData.map((l) => normalizeBom(l.bom)).filter((b): b is string => !!b))];
    const owners = boms.length > 0 ? await fetchOwners(supabase, boms) : [];

    const nameMap = new Map<string, string>();
    for (const m of mappingData) {
      const linked = m.employees;
      const fullName = Array.isArray(linked) ? linked[0]?.full_name : linked?.full_name;
      if (m.external_employee_code && fullName) nameMap.set(m.external_employee_code, fullName);
    }
    const stdMap = new Map<string, number>();
    for (const s of stdRows) {
      const value = Number(s.standard_minutes_per_unit);
      if (value > 0) stdMap.set(s.item_code, value);
    }

    setLines(logData);
    setSolo(soloBomIds(owners));
    setStandards(stdMap);
    setNames(nameMap);
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => { loadMonths(); }, [loadMonths]);
  useEffect(() => { if (selectedMonth) loadPeriod(); }, [selectedMonth, loadPeriod]);

  const activeMonths = useMemo(() => {
    if (selectedMonth === LAST_12) {
      return [...new Set(lines.map((l) => l.period_month).filter(Boolean))].sort();
    }
    return selectedMonth ? [selectedMonth] : [];
  }, [selectedMonth, lines]);

  const { people, exclusions } = useMemo(
    () => summarizePeople(lines, solo, standards),
    [lines, solo, standards]
  );

  // Slices globales — Moy. équipe % recalculée par employé en excluant celui-ci
  const allSlices = useMemo(
    () => buildPersonSlices(lines, solo, standards),
    [lines, solo, standards]
  );

  const exclusionCounts = useMemo(() => {
    const counts = new Map<ExclusionReason, number>();
    for (const ex of exclusions) counts.set(ex.reason, (counts.get(ex.reason) ?? 0) + 1);
    return [...counts.entries()];
  }, [exclusions]);

  function nameOf(idSap: string): string {
    return names.get(idSap) ?? `#${idSap}`;
  }

  function openItem(itemCode: string, quantity: number, actual: number, target: number) {
    const varianceMinutes = target - actual;
    setFocus({
      itemCode,
      series: extractSeries(itemCode),
      productionCount: 0,
      quantity,
      actualMinutes: actual,
      targetMinutes: target,
      varianceMinutes,
      variancePct: target > 0 ? (varianceMinutes / target) * 100 : 0,
      ratio: target > 0 ? actual / target : null,
    });
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Prod par employé"
        subtitle="Rendement sur les BOM faits par une seule personne. Le total d'équipe reste sur KPI Production."
      />
      <p className="mb-6 -mt-2">
        <Link
          href="/kpi/production/employees/aide"
          className="text-sm text-primary hover:underline"
        >
          Comprendre les colonnes →
        </Link>
      </p>

      {months.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {months.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                m === selectedMonth ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {monthLabel(m)}
            </button>
          ))}
          <button
            onClick={() => setSelectedMonth(LAST_12)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              selectedMonth === LAST_12 ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            12 derniers mois
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      ) : people.length === 0 ? (
        <p className="text-slate-500">Aucun log Prod employé pour cette période.</p>
      ) : (
        <>
          {/* Tableau principal */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-semibold" title="Employé (clic pour voir le détail par item)">Employé</th>
                  <th className="px-3 py-3 text-right font-semibold cursor-help" title="Nombre de BOM faits par cette personne seule, inclus dans le rendement">BOM</th>
                  <th className="px-3 py-3 text-right font-semibold cursor-help" title="Temps réel passé sur les BOM solo inclus">Réel</th>
                  <th className="px-3 py-3 text-right font-semibold cursor-help" title="Temps cible imputé (standard × unités) sur les mêmes BOM solo">Cible</th>
                  <th className="px-3 py-3 text-right font-semibold cursor-help" title="Cible − réel. Négatif = au-dessus du standard">Écart</th>
                  <th className="px-3 py-3 text-right font-semibold cursor-help" title="Nombre de punches fermés à quantité 0, avec le temps des BOM solo entièrement à 0">Fermé à 0</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {people.map((row) => (
                  <PersonBlock
                    key={row.idSap}
                    row={row}
                    name={nameOf(row.idSap)}
                    showId={names.has(row.idSap)}
                    open={openId === row.idSap}
                    lines={lines}
                    solo={solo}
                    standards={standards}
                    allSlices={allSlices}
                    onToggle={() => setOpenId((cur) => (cur === row.idSap ? null : row.idSap))}
                    onOpenItem={openItem}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            L&apos;écart est cible − réel sur les BOM solo inclus (sert au tri). Moy. équipe % = pairs sur le même item, sans cet employé.
            {" "}
            <Link href="/kpi/production/employees/aide" className="text-primary hover:underline">
              Voir les formules
            </Link>
          </p>

          {/* Hors rendement — en bas de page */}
          {exclusionCounts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 mt-8">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Hors rendement</h3>
              <p className="text-xs text-slate-400 mb-3">
                Punches exclus du calcul de rendement. Ils ne comptent ni dans le réel ni dans la cible.
              </p>
              <div className="flex flex-wrap gap-3 mb-3">
                {exclusionCounts.map(([reason, count]) => (
                  <span key={reason} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                    {EXCLUSION_LABELS[reason] ?? reason} : {count}
                  </span>
                ))}
              </div>
              <ul className="text-xs text-slate-500 space-y-1 max-h-40 overflow-y-auto">
                {exclusions.slice(0, 30).map((ex: PersonExclusion, i) => (
                  <li key={`${ex.idSap}-${ex.bom}-${ex.itemCode}-${i}`}>
                    {nameOf(ex.idSap)} · {ex.itemCode} · BOM {ex.bom} · {EXCLUSION_LABELS[ex.reason]} · {formatMinutes(ex.minutes)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {focus && (
        <ProductionDrillModal
          item={focus}
          months={activeMonths}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}

function PersonBlock({
  row,
  name,
  showId,
  open,
  lines,
  solo,
  standards,
  allSlices,
  onToggle,
  onOpenItem,
}: {
  row: PersonProductionRow;
  name: string;
  showId: boolean;
  open: boolean;
  lines: LogLine[];
  solo: Set<string>;
  standards: Map<string, number>;
  allSlices: PersonSlice[];
  onToggle: () => void;
  onOpenItem: (itemCode: string, quantity: number, actual: number, target: number) => void;
}) {
  const slices = useMemo((): PersonSlice[] => {
    if (!open) return [];
    return buildPersonSlices(
      lines.filter((l) => l.id_sap === row.idSap),
      solo,
      standards
    ).filter((s) => s.included);
  }, [open, lines, row.idSap, solo, standards]);

  const teamStats = useMemo(
    () => (open ? teamStatsByItem(allSlices, { excludeIdSap: row.idSap }) : new Map()),
    [open, allSlices, row.idSap]
  );

  // Tableau plat d'items, trié par écart total (plus négatif = plus coûteux = en premier)
  const itemRows = useMemo(() => {
    const map = new Map<string, { quantity: number; minutes: number; target: number }>();
    for (const slice of slices) {
      const acc = map.get(slice.itemCode) ?? { quantity: 0, minutes: 0, target: 0 };
      acc.quantity += slice.quantity;
      acc.minutes += slice.minutes;
      acc.target += slice.targetMinutes;
      map.set(slice.itemCode, acc);
    }
    return [...map.entries()]
      .sort(([, a], [, b]) => (a.target - a.minutes) - (b.target - b.minutes));
  }, [slices]);

  return (
    <>
      <tr className="hover:bg-slate-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-2">
            <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", open ? "" : "-rotate-90")} />
            <span className="font-medium text-slate-800">{name}</span>
            {showId && <span className="font-mono text-xs text-slate-400">#{row.idSap}</span>}
          </span>
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-slate-600">{row.soloBomCount}</td>
        <td className="px-3 py-3 text-right tabular-nums">{formatMinutes(row.actualMinutes)}</td>
        <td className="px-3 py-3 text-right tabular-nums">{formatMinutes(row.targetMinutes)}</td>
        <td className={cn("px-3 py-3 text-right tabular-nums font-medium",
          row.varianceMinutes > 0 ? "text-[#047857]" : row.varianceMinutes < 0 ? "text-primary" : "text-slate-500"
        )}>
          {row.targetMinutes > 0 ? fmtSigned(row.varianceMinutes) : "—"}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
          {row.zeroCloseCount}
          {row.zeroCloseMinutes > 0 && <span className="text-slate-400"> · {formatMinutes(row.zeroCloseMinutes)}</span>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-white px-0 py-0 border-b border-slate-100">
            {itemRows.length === 0 ? (
              <p className="text-xs text-slate-500 px-6 py-3">Aucun BOM solo inclus dans le rendement pour cet employé.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase tracking-wide border-y border-slate-100">
                    <th className="px-6 py-2 text-left font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="Temps réel total sur cet item (BOM solo inclus)">Réel</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="Temps cible total = standard × unités">Cible</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="Cible − réel. Sert surtout à trier les items coûteux">Écart</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="Temps réel ÷ unités produites">Réel / u</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="Temps standard par unité (référence)">Cible / u</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="(Cible ÷ Réel) × 100. ≥ 100 % = dans le standard ou mieux">Vous %</th>
                    <th className="px-3 py-2 text-right font-semibold cursor-help" title="Même indice pour les autres employés (BOM solo), sans vous. « — » si aucun pair">Moy. équipe %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {itemRows.map(([code, acc]) => {
                    const ecart = acc.target - acc.minutes;
                    const personPct = acc.target > 0 && acc.minutes > 0
                      ? (acc.target / acc.minutes) * 100
                      : null;
                    const teamPct = teamStats.get(code)?.rendementPct ?? null;
                    const isPersonal = teamPct !== null && personPct !== null && Math.abs(personPct - teamPct) >= 10;
                    const actualPerUnit = acc.quantity > 0 ? acc.minutes / acc.quantity : null;
                    const targetPerUnit = standards.get(code) ?? (acc.quantity > 0 && acc.target > 0 ? acc.target / acc.quantity : null);

                    return (
                      <tr
                        key={code}
                        className="bg-white hover:bg-slate-50 cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); onOpenItem(code, acc.quantity, acc.minutes, acc.target); }}
                      >
                        <td className="px-6 py-2 font-mono font-semibold text-slate-800">{code}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatMinutes(acc.minutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatMinutes(acc.target)}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums font-semibold",
                          ecart > 0 ? "text-[#047857]" : ecart < 0 ? "text-primary" : "text-slate-500"
                        )}>
                          {fmtSigned(ecart)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {actualPerUnit != null ? formatUnitMinutes(actualPerUnit) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {targetPerUnit != null ? formatUnitMinutes(targetPerUnit) : "—"}
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums",
                          personPct === null ? "text-slate-400" :
                          personPct >= 100 ? "text-[#047857]" : "text-primary"
                        )}>
                          {personPct !== null ? `${personPct.toFixed(0)} %` : "—"}
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums",
                          teamPct === null ? "text-slate-400" :
                          isPersonal ? "font-semibold text-slate-700" : "text-slate-400"
                        )}>
                          {teamPct !== null ? `${teamPct.toFixed(0)} %` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
