"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, Package, Users, Clock, TrendingUp, AlertTriangle, AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { PickingAnnualChart } from "@/components/kpi/PickingAnnualChart";
import { cn } from "@/lib/utils";
import {
  computeTeamPickingSummary,
  computeEmployeePickingSummaries,
  computePickingPeriodBuckets,
  computeLogQuality,
  formatAvgLinesPerWave,
  formatAvgPicklistsPerWave,
  type PickingDailyRow,
  type PickingWaveRow,
  type S8PickingLog,
} from "@/lib/picking";
import { fetchPickingWaveStats, fetchPickingWaveStatsFrom } from "@/lib/warehouseData";
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

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function formatRate(v: number | null, digits = 1): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

const LAST_12 = "last-12";

export default function KpiPickingPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(LAST_12);
  const [sapRows, setSapRows] = useState<PickingDailyRow[]>([]);
  const [waveRows, setWaveRows] = useState<PickingWaveRow[]>([]);
  const [s8Logs, setS8Logs] = useState<S8PickingLog[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [logQualityOpen, setLogQualityOpen] = useState(false);

  const isLast12View = selectedMonth === LAST_12;

  const loadMeta = useCallback(async () => {
    const source = await fetchSapDataSource();
    const [{ data: monthRows }, { data: emps }] = await Promise.all([
      source === "wrapper"
        ? Promise.resolve({ data: last12MonthKeys().map((period_month) => ({ period_month })) })
        : fetchAllRows<{ period_month: string }>((from, to) =>
            supabase
              .from("picking_daily_counts")
              .select("period_month")
              .order("period_month", { ascending: false })
              .range(from, to)
          ),
      supabase.from("employees").select("id, full_name"),
    ]);

    const unique = [...new Set(monthRows.map((d) => d.period_month))];
    setMonths(unique);
    setEmployeeNames(new Map((emps ?? []).map((e) => [e.id, e.full_name])));
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let periodFilter: (q: any) => any;
    let monthStart: string;
    let monthEnd: string;
    let cutoffMonth = "";

    if (selectedMonth === LAST_12) {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
      monthStart = `${cutoffMonth}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      monthEnd = `${curMonth}-${String(lastDay).padStart(2, "0")}`;
      periodFilter = (q: any) => q.gte("period_month", cutoffMonth);
    } else {
      monthStart = `${selectedMonth}-01`;
      const [y, m] = selectedMonth.split("-").map(Number);
      const lastDay = new Date(y!, m!, 0).getDate();
      monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
      periodFilter = (q: any) => q.eq("period_month", selectedMonth);
    }

    const { data: taskMaps } = await supabase
      .from("task_mapping")
      .select("id")
      .eq("kpi_department", "Picking")
      .eq("include_in_kpi", true);

    const taskIds = (taskMaps ?? []).map((t) => t.id);
    const source = await fetchSapDataSource();

    const s8Promise =
      taskIds.length > 0
        ? fetchAllRows<S8PickingLog>((from, to) =>
            supabase
              .from("s8_time_logs")
              .select("employee_id, log_date, duration_minutes")
              .in("task_mapping_id", taskIds)
              .gte("log_date", monthStart)
              .lte("log_date", monthEnd)
              .range(from, to)
          )
        : Promise.resolve({ data: [] as S8PickingLog[], error: null });

    if (source === "wrapper") {
      const monthList =
        selectedMonth === LAST_12
          ? monthsFrom(cutoffMonth)
          : [selectedMonth];
      const [pickParts, s8Res] = await Promise.all([
        Promise.all(
          monthList.map(async (ym) => {
            const json = (await fetchSapKpiMonth("picking", ym)) as {
              days: PickingDailyRow[];
              waves: PickingWaveRow[];
            };
            return json;
          })
        ),
        s8Promise,
      ]);
      setSapRows(pickParts.flatMap((p) => p.days ?? []));
      setWaveRows(pickParts.flatMap((p) => p.waves ?? []));
      setS8Logs(s8Res.data.filter((l) => l.employee_id));
      setLoading(false);
      return;
    }

    const [sapRes, s8Res, waves] = await Promise.all([
      fetchAllRows<PickingDailyRow>((from, to) =>
        periodFilter(
          supabase
            .from("picking_daily_counts")
            .select(
              "id, employee_id, external_user_code, external_user_name, doc_date, period_month, line_count, wave_count, picklist_count"
            )
        ).range(from, to)
      ),
      s8Promise,
      selectedMonth === LAST_12
        ? fetchPickingWaveStatsFrom(supabase, monthStart.slice(0, 7))
        : fetchPickingWaveStats(supabase, selectedMonth),
    ]);

    setSapRows(sapRes.data);
    setWaveRows(waves);
    setS8Logs(s8Res.data.filter((l) => l.employee_id) as S8PickingLog[]);
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => {
    loadMeta().then(() => setLoading(false));
  }, [loadMeta]);

  useEffect(() => {
    if (selectedMonth) loadData();
  }, [selectedMonth, loadData]);

  // Carte équipe : toutes les heures (blocs courts inclus)
  const team = useMemo(
    () =>
      computeTeamPickingSummary(
        sapRows,
        s8Logs,
        waveRows,
        isLast12View ? undefined : selectedMonth
      ),
    [sapRows, s8Logs, waveRows, isLast12View, selectedMonth]
  );

  // Tableau employés : l/h basé sur blocs >= 30 min seulement
  const employees = useMemo(() => {
    const list = computeEmployeePickingSummaries(sapRows, s8Logs, employeeNames);
    const withRate = list.filter((e) => e.linesPerHour != null);
    const avg =
      withRate.length > 0
        ? withRate.reduce((s, e) => s + (e.linesPerHour ?? 0), 0) / withRate.length
        : null;
    return { list, avg };
  }, [sapRows, s8Logs, employeeNames]);

  // KPI qualité des logs (étape 2)
  const logQuality = useMemo(
    () => computeLogQuality(sapRows, s8Logs, employeeNames),
    [sapRows, s8Logs, employeeNames]
  );


  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="KPI — Picking"
        subtitle="Lignes SAP picking ÷ heures S8 tâche Picking · densités vague / picklist"
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
                  ? "bg-primary text-white"
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
                ? "bg-primary text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            12 derniers mois
          </button>
        </div>
      )}


      {loading ? (
        <div className="text-center py-16 text-slate-400">Chargement…</div>
      ) : sapRows.length === 0 && s8Logs.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
          <p className="text-sm text-slate-400 mt-1">
            Importez l&apos;export SAP via Administration → Import picking.
          </p>
        </div>
      ) : (
        <>
          {isLast12View && (
            <PickingAnnualChart
              sapRows={sapRows}
              s8Logs={s8Logs}
              waveRows={waveRows}
              employeeNames={employeeNames}
            />
          )}

          {/* Cartes équipe — rythme basé sur TOUTES les heures */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <KpiCard
              icon={Package}
              label="Lignes pickées"
              value={team.totalLines.toLocaleString("fr-CA")}
            />
            <KpiCard
              icon={Clock}
              label="Heures S8 Picking"
              value={formatHours(team.totalHours)}
            />
            <KpiCard
              icon={TrendingUp}
              label="Lignes / heure équipe"
              value={formatRate(team.linesPerHour)}
              sub="Toutes heures S8 incluses"
            />
            <KpiCard
              icon={Users}
              label="Employés actifs"
              value={String(team.activeEmployees)}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard icon={Package} label="Vagues (WaveKey)" value={team.totalWaves.toLocaleString("fr-CA")} />
            <KpiCard icon={Package} label="Picklists" value={team.totalPicklists.toLocaleString("fr-CA")} />
            <KpiCard
              icon={TrendingUp}
              label="Lignes moy. / vague"
              value={formatAvgLinesPerWave(team.linesPerWave)}
              sub={
                team.linesPerWaveExclSinglePl != null
                  ? `${formatAvgLinesPerWave(team.linesPerWaveExclSinglePl)} hors 1 PL`
                  : undefined
              }
            />
            <KpiCard
              icon={TrendingUp}
              label="Picklists moy. / vague"
              value={formatAvgPicklistsPerWave(team.picklistsPerWave)}
              sub={
                team.picklistsPerWaveExclSinglePl != null
                  ? `${formatAvgPicklistsPerWave(team.picklistsPerWaveExclSinglePl)} hors 1 PL`
                  : undefined
              }
            />
          </div>

          {/* KPI qualité des logs — accordéon */}
          <div className="bg-white border border-slate-200 rounded-xl mb-6 overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-5 py-4 hover:bg-slate-50 text-left"
              onClick={() => setLogQualityOpen((v) => !v)}
            >
              <AlertCircle className={cn(
                "w-4 h-4 shrink-0",
                logQuality.unmatchedPct > 20 ? "text-red-500" : logQuality.unmatchedPct > 5 ? "text-amber-500" : "text-green-500"
              )} />
              <h3 className="text-sm font-semibold text-slate-700">Qualité des logs S8</h3>
              <span className={cn(
                "ml-auto text-sm font-bold mr-2",
                logQuality.unmatchedPct > 20 ? "text-red-600" : logQuality.unmatchedPct > 5 ? "text-amber-600" : "text-green-600"
              )}>
                {logQuality.unmatchedPct.toFixed(1)}% de lignes sans temps S8
              </span>
              {logQualityOpen
                ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
              }
            </button>

            {logQualityOpen && (
              <div className="px-5 pb-5 border-t border-slate-100">
                <div className="grid grid-cols-2 gap-4 mt-4 mb-4">
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-slate-800">
                      {logQuality.unmatchedLines.toLocaleString("fr-CA")}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Lignes SAP sans S8 picking ce jour</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-slate-800">
                      {logQuality.totalLines.toLocaleString("fr-CA")}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Total lignes pickées</p>
                  </div>
                </div>

                {logQuality.topOffenders.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-slate-500 mb-2">
                      Employés à sensibiliser (lignes sans temps S8)
                    </p>
                    <div className="space-y-1.5">
                      {logQuality.topOffenders.map((o) => (
                        <div key={o.key} className="flex items-center gap-2 text-xs">
                          <div
                            className="h-2 bg-amber-400 rounded-sm shrink-0"
                            style={{
                              width: `${Math.max(4, (o.unmatchedLines / (logQuality.topOffenders[0]?.unmatchedLines ?? 1)) * 160)}px`,
                            }}
                          />
                          <span className="text-slate-700 font-medium">{o.displayName}</span>
                          <span className="text-slate-400 ml-auto">
                            {o.unmatchedLines.toLocaleString("fr-CA")} lignes
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Tableau employés */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">
                Performance par employé ({employees.list.length})
                {employees.avg != null && (
                  <span className="font-normal text-slate-500 ml-2">
                    · moyenne : {employees.avg.toFixed(1)} lignes/h
                    <span className="text-xs ml-1 text-slate-400">(blocs ≥ 30 min)</span>
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

                // Matching : SAP ≠ S8 — seulement en vue mensuelle (pas vue 12 mois)
                const showMismatch =
                  !isLast12View &&
                  emp.daysWithSap > 0 &&
                  emp.daysWithS8 > 0 &&
                  emp.daysWithSap !== emp.daysWithS8;

                const empSap = sapRows.filter((r) =>
                  emp.employeeId
                    ? r.employee_id === emp.employeeId
                    : !r.employee_id && r.external_user_name === emp.displayName
                );
                const empS8 = s8Logs.filter((l) => l.employee_id === emp.employeeId);
                const dayBuckets = computePickingPeriodBuckets(empSap, empS8, "day");

                return (
                  <div key={emp.key}>
                    <button
                      className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 text-left"
                      onClick={() => setExpandedKey(isOpen ? null : emp.key)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {emp.displayName}
                          {!emp.employeeId && (
                            <span className="ml-2 text-xs text-amber-600 font-normal">
                              non mappé
                            </span>
                          )}
                          {showMismatch && (
                            <span className="ml-2 text-xs text-amber-600 font-normal inline-flex items-center gap-0.5">
                              <AlertTriangle className="w-3 h-3" />
                              matching
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {/* Vue annuelle : vagues + picklists seulement */}
                          {isLast12View
                            ? `${emp.totalWaves} vagues · ${emp.totalPicklists} picklists`
                            : `${emp.daysWithSap}j SAP · ${emp.daysWithS8}j S8 · ${emp.totalWaves} vagues · ${emp.totalPicklists} picklists`
                          }
                        </p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-sm font-bold text-slate-800">
                          {emp.totalLines.toLocaleString("fr-CA")}
                        </p>
                        <p className="text-xs text-slate-400">lignes</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-sm font-medium text-slate-700">
                          {formatHours(emp.totalHours)}
                        </p>
                        <p className="text-xs text-slate-400">S8</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        {emp.linesPerHour != null ? (
                          <>
                            <p className="text-sm font-bold text-slate-800">
                              {emp.linesPerHour.toFixed(1)}
                            </p>
                            <p className="text-xs text-slate-400">l/h</p>
                          </>
                        ) : (
                          <p
                            className="text-sm font-semibold text-slate-300 cursor-help"
                            title={
                              !emp.employeeId
                                ? "Non mappé — aucune heure S8 disponible"
                                : emp.insufficientData
                                  ? "Données insuffisantes — tous les blocs S8 < 30 min"
                                  : "Aucune heure S8 picking"
                            }
                          >
                            N/A
                          </p>
                        )}
                        {emp.linesPerHour == null && (
                          <p className="text-xs text-slate-300">l/h</p>
                        )}
                      </div>
                      <div className="text-right shrink-0 w-14 hidden sm:block">
                        <p className="text-sm font-medium text-slate-700">
                          {formatRate(emp.linesPerWave)}
                        </p>
                        <p className="text-xs text-slate-400">lig/vag</p>
                      </div>
                      <div className="text-right shrink-0 w-14 hidden sm:block">
                        <p className="text-sm font-medium text-slate-700">
                          {formatRate(emp.picklistsPerWave)}
                        </p>
                        <p className="text-xs text-slate-400">pl/vag</p>
                      </div>
                      <div className="text-right shrink-0 w-14">
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
                        {emp.validHours < emp.totalHours && emp.totalHours > 0 && (
                          <p className="text-xs text-amber-700 mt-3 mb-2 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {formatHours(emp.totalHours - emp.validHours)} de blocs S8 &lt; 30 min exclus du l/h
                            {emp.validHours > 0
                              ? ` · ${formatHours(emp.validHours)} valides`
                              : " · aucun bloc valide"}
                          </p>
                        )}
                        <p className="text-xs font-semibold text-slate-500 mt-3 mb-2">
                          Détail par jour ({dayBuckets.length} jours)
                        </p>
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="text-left py-1">Jour</th>
                                <th className="text-right py-1">Lignes</th>
                                <th className="text-right py-1">Heures</th>
                                <th className="text-right py-1">l/h</th>
                                <th className="text-right py-1">Vagues</th>
                                <th className="text-right py-1">Picklists</th>
                                <th className="text-right py-1">lig/vag</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {dayBuckets.map((d) => {
                                const hasS8 = d.hours > 0;
                                const hasSap = d.lineCount > 0;
                                return (
                                  <tr
                                    key={d.period}
                                    className={cn(
                                      !hasS8 && hasSap
                                        ? "text-amber-700"
                                        : "text-slate-700"
                                    )}
                                  >
                                    <td className="py-1">{d.label}</td>
                                    <td className="py-1 text-right">{d.lineCount}</td>
                                    <td className="py-1 text-right">{formatHours(d.hours)}</td>
                                    <td className="py-1 text-right font-medium">
                                      {formatRate(d.linesPerHour)}
                                    </td>
                                    <td className="py-1 text-right">{d.waveCount}</td>
                                    <td className="py-1 text-right">{d.picklistCount}</td>
                                    <td className="py-1 text-right">
                                      {d.waveCount > 0
                                        ? (d.lineCount / d.waveCount).toFixed(1)
                                        : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
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
        <Icon className="w-4 h-4 text-primary" />
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
