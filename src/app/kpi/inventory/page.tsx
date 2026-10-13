"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, ClipboardList, Target, Users, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import {
  computeTeamSummary,
  computeEmployeeSummaries,
  computePeriodBuckets,
  type InventoryLine,
  type EmployeeMapping,
  type Granularity,
} from "@/lib/inventory";
import {
  fetchSapDataSource,
  fetchSapKpiMonth,
  last12MonthKeys,
  monthsFrom,
} from "@/lib/sap/source";

const MONTH_LABELS: Record<string, string> = {
  "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
  "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
  "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

function goalColor(pct: number): string {
  if (pct >= 100) return "bg-green-500";
  if (pct >= 80) return "bg-amber-400";
  return "bg-red-400";
}

const LAST_12 = "last-12";

export default function KpiInventoryPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(LAST_12);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [rows, setRows] = useState<InventoryLine[]>([]);
  const [mappings, setMappings] = useState<EmployeeMapping[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map());
  const [monthlyGoal, setMonthlyGoal] = useState(500);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    const source = await fetchSapDataSource();
    const [{ data: monthRows }, { data: maps }, { data: emps }, { data: setting }] =
      await Promise.all([
        source === "wrapper"
          ? Promise.resolve({ data: last12MonthKeys().map((period_month) => ({ period_month })) })
          : fetchAllRows<{ period_month: string }>((from, to) =>
              supabase
                .from("inventory_count_lines")
                .select("period_month")
                .order("period_month", { ascending: false })
                .range(from, to)
            ),
        supabase
          .from("employee_system_mapping")
          .select("employee_id, external_employee_code, external_employee_name, employees(full_name)")
          .eq("system_name", "SAP")
          .eq("is_active", true),
        supabase.from("employees").select("id, full_name"),
        supabase
          .from("inventory_team_settings")
          .select("lines_per_employee_per_month")
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const unique = [...new Set(monthRows.map((d) => d.period_month))];
    setMonths(unique);
    setMappings((maps as unknown as EmployeeMapping[]) ?? []);
    setEmployeeNames(new Map((emps ?? []).map((e) => [e.id, e.full_name])));
    if (setting) setMonthlyGoal(setting.lines_per_employee_per_month);
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);

    const isLast12 = selectedMonth === LAST_12;
    let cutoffMonth = "";
    let periodFilter: (q: any) => any;

    if (isLast12) {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
      periodFilter = (q: any) => q.gte("period_month", cutoffMonth);
    } else {
      periodFilter = (q: any) => q.eq("period_month", selectedMonth);
    }

    const source = await fetchSapDataSource();
    if (source === "wrapper") {
      const monthList = isLast12 ? monthsFrom(cutoffMonth) : [selectedMonth];
      const parts = await Promise.all(
        monthList.map(async (ym) => {
          const json = (await fetchSapKpiMonth("inventory", ym)) as {
            lines: InventoryLine[];
          };
          return json.lines ?? [];
        })
      );
      setRows(parts.flat());
      setLoading(false);
      return;
    }

    const { data } = await fetchAllRows<InventoryLine>((from, to) =>
      periodFilter(
        supabase
          .from("inventory_count_lines")
          .select(
            "id, employee_id, external_user_name, external_user_code, count_date, period_month, item_code, location, has_discrepancy"
          )
      ).range(from, to)
    );
    setRows(data);
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => {
    loadMeta().then(() => setLoading(false));
  }, [loadMeta]);

  useEffect(() => {
    if (selectedMonth) loadData();
  }, [selectedMonth, loadData]);

  const team = useMemo(
    () => computeTeamSummary(rows, monthlyGoal),
    [rows, monthlyGoal]
  );

  const employees = useMemo(
    () => computeEmployeeSummaries(rows, mappings, employeeNames, monthlyGoal),
    [rows, mappings, employeeNames, monthlyGoal]
  );

  const teamPeriodBuckets = useMemo(
    () => computePeriodBuckets(rows, granularity),
    [rows, granularity]
  );

  const maxBucket = Math.max(...teamPeriodBuckets.map((b) => b.lineCount), 1);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="KPI — Inventaire cyclique"
        subtitle={`Objectif équipe : ${monthlyGoal} lignes / employé / mois`}
      />

      {months.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {months.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                selectedMonth === m
                  ? "bg-teal-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {monthLabel(m)}
            </button>
          ))}
          <button
            onClick={() => setSelectedMonth(LAST_12)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              selectedMonth === LAST_12
                ? "bg-teal-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            12 derniers mois
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {(["day", "week", "month"] as Granularity[]).map((g) => (
          <button
            key={g}
            onClick={() => setGranularity(g)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide",
              granularity === g
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {g === "day" ? "Jour" : g === "week" ? "Semaine" : "Mois"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
          <p className="text-sm text-slate-400 mt-1">
            Importez un export SAP via Administration → Import inventaire.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              icon={ClipboardList}
              label="Lignes décomptées"
              value={team.totalLines.toLocaleString("fr-CA")}
            />
            <KpiCard
              icon={Users}
              label="Employés actifs"
              value={String(team.activeEmployees)}
            />
            <KpiCard
              icon={CheckCircle2}
              label="Taux de conformité"
              value={`${team.qualityPct.toFixed(1)}%`}
              sub={`${team.discrepancyCount} écart${team.discrepancyCount > 1 ? "s" : ""} d'inventaire`}
            />
            <KpiCard
              icon={Target}
              label="Avancement objectif"
              value={`${Math.round(team.goalProgressPct)}%`}
              sub={`Cible : ${monthlyGoal} × ${team.activeEmployees} employés`}
            />
          </div>

          {/* Histogramme équipe */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Volume par {granularity === "day" ? "jour" : granularity === "week" ? "semaine" : "mois"}
            </h3>
            <div className="flex items-end gap-1 h-32 overflow-x-auto">
              {teamPeriodBuckets.map((b) => (
                <div key={b.period} className="flex flex-col items-center min-w-[2rem] flex-1">
                  <div
                    className="w-full bg-teal-500 rounded-t min-h-[2px] transition-all"
                    style={{ height: `${(b.lineCount / maxBucket) * 100}%` }}
                    title={`${b.lineCount} lignes`}
                  />
                  <p className="text-[9px] text-slate-400 mt-1 truncate max-w-full rotate-0">
                    {granularity === "week" ? b.period.slice(5) : b.label.slice(0, 6)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Tableau employés */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">
                Performance par employé ({employees.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {employees.map((emp) => {
                const isOpen = expandedKey === emp.key;
                const empRows = rows.filter((r) =>
                  emp.employeeId
                    ? r.employee_id === emp.employeeId
                    : r.external_user_name === emp.displayName && !r.employee_id
                );
                const buckets = computePeriodBuckets(empRows, granularity);
                const discrepancies = empRows
                  .filter((r) => r.has_discrepancy)
                  .slice(0, 10);

                return (
                  <div key={emp.key}>
                    <button
                      className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 text-left"
                      onClick={() => setExpandedKey(isOpen ? null : emp.key)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {emp.displayName}
                          {!emp.employeeId && (
                            <span className="ml-2 text-xs text-amber-600 font-normal">non mappé</span>
                          )}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-xs">
                            <div
                              className={cn("h-full rounded-full", goalColor(emp.goalPct))}
                              style={{ width: `${Math.min(emp.goalPct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {emp.lineCount} / {emp.monthlyGoal} ({Math.round(emp.goalPct)}%)
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-slate-800">{emp.lineCount}</p>
                        <p className="text-xs text-slate-400">lignes</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-sm font-medium text-amber-700">{emp.discrepancyCount}</p>
                        <p className="text-xs text-slate-400">écarts d&apos;inventaire</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-sm font-medium text-green-700">
                          {emp.qualityPct.toFixed(1)}%
                        </p>
                        <p className="text-xs text-slate-400">conformité</p>
                      </div>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    {isOpen && (
                      <div className="px-5 pb-4 bg-slate-50 border-t border-slate-100">
                        <div className="grid sm:grid-cols-2 gap-4 mt-3">
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-2">
                              Volume par période
                            </p>
                            <div className="space-y-1">
                              {buckets.map((b) => (
                                <div key={b.period} className="flex justify-between text-xs">
                                  <span className="text-slate-600">{b.label}</span>
                                  <span className="font-medium">{b.lineCount} lignes</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {discrepancies.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                                Derniers écarts d&apos;inventaire
                              </p>
                              <div className="space-y-1">
                                {discrepancies.map((d) => (
                                  <div key={d.id} className="text-xs text-slate-600">
                                    {d.count_date} · {d.item_code ?? "—"} @ {d.location ?? "—"}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <Icon className="w-4 h-4 text-teal-500" />
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
