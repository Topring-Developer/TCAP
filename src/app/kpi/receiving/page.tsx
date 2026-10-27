"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, PackageCheck, Users, Clock, TrendingUp, AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import {
  computeTeamReceivingSummary,
  computeEmployeeReceivingSummaries,
  computeReceivingPeriodBuckets,
  type ReceivingDailyRow,
  type S8ReceivingLog,
  type Granularity,
} from "@/lib/receiving";
import {
  fetchSapDataSource,
  fetchSapKpiMonth,
} from "@/lib/sap/source";
import {
  fetchTwmsImportedMonths,
  twmsMonthsInLast12,
} from "@/lib/twmsMonths";

const MONTH_LABELS: Record<string, string> = {
  "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
  "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
  "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function formatLinesPerHour(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(1);
}

const LAST_12 = "last-12";

export default function KpiReceivingPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(LAST_12);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [sapRows, setSapRows] = useState<ReceivingDailyRow[]>([]);
  const [s8Logs, setS8Logs] = useState<S8ReceivingLog[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map());
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    const [twmsMonths, { data: emps }] = await Promise.all([
      fetchTwmsImportedMonths(supabase),
      supabase
        .from("employees")
        .select("id, full_name, include_in_receiving_kpi"),
    ]);

    setMonths(twmsMonths);
    setSelectedMonth((cur) =>
      cur === LAST_12 || twmsMonths.includes(cur) ? cur : twmsMonths[0] ?? LAST_12
    );

    const names = new Map<string, string>();
    const included = new Set<string>();
    for (const e of emps ?? []) {
      names.set(e.id, e.full_name);
      if (e.include_in_receiving_kpi !== false) included.add(e.id);
    }
    setEmployeeNames(names);
    setIncludedIds(included);
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);

    const isLast12 = selectedMonth === LAST_12;
    const twmsMonths =
      months.length > 0 ? months : await fetchTwmsImportedMonths(supabase);
    const last12Twms = twmsMonthsInLast12(twmsMonths);

    let monthStart: string;
    let monthEnd: string;
    let monthList: string[];
    let periodFilter: (q: any) => any;

    if (isLast12) {
      monthList = last12Twms;
      if (monthList.length === 0) {
        setSapRows([]);
        setS8Logs([]);
        setLoading(false);
        return;
      }
      const oldest = [...monthList].sort()[0]!;
      const newest = [...monthList].sort().reverse()[0]!;
      const [ny, nm] = newest.split("-").map(Number);
      monthStart = `${oldest}-01`;
      monthEnd = `${newest}-${String(new Date(ny!, nm!, 0).getDate()).padStart(2, "0")}`;
      periodFilter = (q: any) => q.in("period_month", monthList);
    } else {
      monthList = [selectedMonth];
      monthStart = `${selectedMonth}-01`;
      const [y, m] = selectedMonth.split("-").map(Number);
      const lastDay = new Date(y!, m!, 0).getDate();
      monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
      periodFilter = (q: any) => q.eq("period_month", selectedMonth);
    }

    const [{ data: emps }, { data: taskMaps }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, include_in_receiving_kpi")
        .eq("is_active", true),
      supabase
        .from("task_mapping")
        .select("id")
        .eq("kpi_department", "Réception")
        .eq("include_in_kpi", true),
    ]);

    const included = new Set(
      (emps ?? [])
        .filter((e) => e.include_in_receiving_kpi !== false)
        .map((e) => e.id)
    );
    setIncludedIds(included);

    const taskIds = (taskMaps ?? []).map((t) => t.id);
    const source = await fetchSapDataSource();

    const s8Promise =
      taskIds.length > 0
        ? fetchAllRows<{
            employee_id: string | null;
            log_date: string;
            duration_minutes: number;
          }>((from, to) =>
            supabase
              .from("s8_time_logs")
              .select("employee_id, log_date, duration_minutes")
              .in("task_mapping_id", taskIds)
              .gte("log_date", monthStart)
              .lte("log_date", monthEnd)
              .range(from, to)
          )
        : Promise.resolve({ data: [] as S8ReceivingLog[], error: null });

    let sapData: ReceivingDailyRow[] = [];
    let s8Data: S8ReceivingLog[] = [];

    if (source === "wrapper") {
      const [parts, s8Res] = await Promise.all([
        Promise.all(
          monthList.map(async (ym) => {
            const json = (await fetchSapKpiMonth("receiving", ym)) as {
              days: ReceivingDailyRow[];
            };
            return json.days ?? [];
          })
        ),
        s8Promise,
      ]);
      sapData = parts.flat();
      s8Data = s8Res.data as S8ReceivingLog[];
    } else {
      const [sapRes, s8Res] = await Promise.all([
        fetchAllRows<ReceivingDailyRow>((from, to) =>
          periodFilter(
            supabase
              .from("receiving_daily_counts")
              .select("id, employee_id, external_user_name, doc_date, period_month, line_count")
          ).range(from, to)
        ),
        s8Promise,
      ]);
      sapData = sapRes.data;
      s8Data = s8Res.data as S8ReceivingLog[];
    }

    const filteredSap = sapData.filter(
      (r) => r.employee_id && included.has(r.employee_id)
    );
    const filteredS8 = s8Data.filter(
      (l) => l.employee_id && included.has(l.employee_id)
    );

    setSapRows(filteredSap);
    setS8Logs(filteredS8);
    setLoading(false);
  }, [selectedMonth, months]);

  useEffect(() => {
    loadMeta().then(() => setLoading(false));
  }, [loadMeta]);

  useEffect(() => {
    if (selectedMonth) loadData();
  }, [selectedMonth, loadData]);

  const team = useMemo(
    () => computeTeamReceivingSummary(sapRows, s8Logs),
    [sapRows, s8Logs]
  );

  const employees = useMemo(() => {
    const list = computeEmployeeReceivingSummaries(
      sapRows,
      s8Logs,
      employeeNames,
      includedIds
    );
    const avg =
      list.filter((e) => e.linesPerHour != null).length > 0
        ? list.reduce((s, e) => s + (e.linesPerHour ?? 0), 0) /
          list.filter((e) => e.linesPerHour != null).length
        : null;
    return { list, avg };
  }, [sapRows, s8Logs, employeeNames, includedIds]);

  const teamPeriodBuckets = useMemo(
    () => computeReceivingPeriodBuckets(sapRows, granularity),
    [sapRows, granularity]
  );

  const maxBucket = Math.max(...teamPeriodBuckets.map((b) => b.lineCount), 1);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="KPI — Réception"
        subtitle="Lignes SAP réception ÷ heures S8 tâche Réception (employés entrepôt uniquement)"
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
                  ? "bg-orange-600 text-white"
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
                ? "bg-orange-600 text-white"
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
      ) : sapRows.length === 0 && s8Logs.length === 0 ? (
        <div className="text-center py-16">
          <PackageCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
          <p className="text-sm text-slate-400 mt-1">
            Importez l&apos;export SAP via Administration → Import réception.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              icon={PackageCheck}
              label="Lignes réceptionnées"
              value={team.totalLines.toLocaleString("fr-CA")}
            />
            <KpiCard
              icon={Clock}
              label="Heures S8 Réception"
              value={formatHours(team.totalHours)}
            />
            <KpiCard
              icon={TrendingUp}
              label="Lignes / heure équipe"
              value={formatLinesPerHour(team.linesPerHour)}
            />
            <KpiCard
              icon={Users}
              label="Employés actifs"
              value={String(team.activeEmployees)}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Volume SAP par {granularity === "day" ? "jour" : granularity === "week" ? "semaine" : "mois"}
            </h3>
            <div className="flex items-end gap-1 h-32 overflow-x-auto">
              {teamPeriodBuckets.map((b) => (
                <div key={b.period} className="flex flex-col items-center min-w-[2rem] flex-1">
                  <div
                    className="w-full bg-orange-500 rounded-t min-h-[2px] transition-all"
                    style={{ height: `${(b.lineCount / maxBucket) * 100}%` }}
                    title={`${b.lineCount} lignes`}
                  />
                  <p className="text-[9px] text-slate-400 mt-1 truncate max-w-full">
                    {granularity === "week" ? b.period.slice(5) : b.label.slice(0, 6)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">
                Performance par employé ({employees.list.length})
                {employees.avg != null && (
                  <span className="font-normal text-slate-500 ml-2">
                    · moyenne équipe : {employees.avg.toFixed(1)} lignes/h
                  </span>
                )}
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {employees.list.map((emp) => {
                const isOpen = expandedKey === emp.key;
                const vsAvg =
                  emp.linesPerHour != null && employees.avg != null && employees.avg > 0
                    ? ((emp.linesPerHour - employees.avg) / employees.avg) * 100
                    : null;
                const mismatch =
                  emp.daysWithSap > 0 &&
                  emp.daysWithS8 > 0 &&
                  emp.daysWithSap !== emp.daysWithS8;

                const empSap = sapRows.filter((r) =>
                  emp.employeeId
                    ? r.employee_id === emp.employeeId
                    : r.external_user_name === emp.displayName
                );
                const empS8 = s8Logs.filter((l) => l.employee_id === emp.employeeId);
                const buckets = computeReceivingPeriodBuckets(empSap, granularity);

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
                          {mismatch && (
                            <span className="ml-2 text-xs text-amber-600 font-normal inline-flex items-center gap-0.5">
                              <AlertTriangle className="w-3 h-3" />
                              matching
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {emp.daysWithSap}j SAP · {emp.daysWithS8}j S8
                        </p>
                      </div>
                      <div className="text-right shrink-0 w-20">
                        <p className="text-sm font-bold text-slate-800">
                          {emp.totalLines.toLocaleString("fr-CA")}
                        </p>
                        <p className="text-xs text-slate-400">lignes</p>
                      </div>
                      <div className="text-right shrink-0 w-20">
                        <p className="text-sm font-medium text-slate-700">
                          {formatHours(emp.totalHours)}
                        </p>
                        <p className="text-xs text-slate-400">S8</p>
                      </div>
                      <div className="text-right shrink-0 w-20">
                        <p className="text-sm font-bold text-orange-700">
                          {formatLinesPerHour(emp.linesPerHour)}
                        </p>
                        <p className="text-xs text-slate-400">lignes/h</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        {vsAvg != null ? (
                          <p
                            className={cn(
                              "text-sm font-medium",
                              vsAvg >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
                            {vsAvg >= 0 ? "+" : ""}
                            {vsAvg.toFixed(0)}%
                          </p>
                        ) : (
                          <p className="text-sm text-slate-300">—</p>
                        )}
                        <p className="text-xs text-slate-400">vs moy.</p>
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
                              Lignes SAP par période
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
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-2">
                              Détail jours ({empSap.length} entrées SAP)
                            </p>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {empSap
                                .sort((a, b) => a.doc_date.localeCompare(b.doc_date))
                                .map((r) => {
                                  const hasS8 = empS8.some((l) => l.log_date === r.doc_date);
                                  return (
                                    <div
                                      key={r.id}
                                      className={cn(
                                        "flex justify-between text-xs",
                                        !hasS8 && "text-amber-700"
                                      )}
                                    >
                                      <span>{r.doc_date}</span>
                                      <span>
                                        {r.line_count} lignes
                                        {!hasS8 && " · pas de temps S8"}
                                      </span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
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
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-orange-500" />
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
