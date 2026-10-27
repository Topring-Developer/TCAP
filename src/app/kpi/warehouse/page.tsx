"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown, ChevronUp, AlertCircle, AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { WarehouseTeamCards } from "@/components/kpi/WarehouseTeamCards";
import { cn } from "@/lib/utils";
import type { PickingDailyRow, PickingWaveRow } from "@/lib/picking";
import type { PackagingDailyRow } from "@/lib/packaging";
import {
  computeWarehouseTeam,
  computeWarehouseEmployees,
  computeWarehouseDays,
  topMislogOffenders,
  priorAvailableMonths,
  rollingBenchmark,
  MAX_FLOOR_HOURS_PER_DAY,
  type S8Log,
  type RollingBenchmark,
  type WarehouseTeamSummary,
} from "@/lib/warehouse";
import { fetchWarehouseMonth, fetchPickingWaveStatsFrom } from "@/lib/warehouseData";
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
  if (h <= 0) return "0 min";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function formatDay(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-CA", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const LAST_12 = "last-12";

export default function KpiWarehousePage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [pickRows, setPickRows] = useState<PickingDailyRow[]>([]);
  const [packRows, setPackRows] = useState<PackagingDailyRow[]>([]);
  const [waveRows, setWaveRows] = useState<PickingWaveRow[]>([]);
  const [pickLogs, setPickLogs] = useState<S8Log[]>([]);
  const [expLogs, setExpLogs] = useState<S8Log[]>([]);
  const [prevTeam, setPrevTeam] = useState<WarehouseTeamSummary | null>(null);
  const [rolling, setRolling] = useState<RollingBenchmark | null>(null);
  const [previousRolling, setPreviousRolling] = useState<RollingBenchmark | null>(null);
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const isLast12 = selectedMonth === LAST_12;

  const loadMeta = useCallback(async () => {
    const [twmsMonths, { data: emps }] = await Promise.all([
      fetchTwmsImportedMonths(supabase),
      supabase.from("employees").select("id, full_name"),
    ]);
    setMonths(twmsMonths);
    setEmployeeNames(new Map((emps ?? []).map((e) => [e.id, e.full_name])));
    setSelectedMonth((cur) =>
      cur && (cur === LAST_12 || twmsMonths.includes(cur))
        ? cur
        : twmsMonths[0] ?? ""
    );
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);
    setPickRows([]);
    setPackRows([]);
    setWaveRows([]);
    setPrevTeam(null);
    setRolling(null);
    setPreviousRolling(null);

    if (selectedMonth === LAST_12) {
      const twmsMonths =
        months.length > 0 ? months : await fetchTwmsImportedMonths(supabase);
      const monthList = twmsMonthsInLast12(twmsMonths);
      if (monthList.length === 0) {
        setLoading(false);
        return;
      }
      const oldest = [...monthList].sort()[0]!;
      const newest = [...monthList].sort().reverse()[0]!;
      const [ny, nm] = newest.split("-").map(Number);
      const monthStart = `${oldest}-01`;
      const monthEnd = `${newest}-${String(new Date(ny!, nm!, 0).getDate()).padStart(2, "0")}`;
      const source = await fetchSapDataSource();
      const [{ data: pickTasks }, { data: expTasks }] = await Promise.all([
        supabase.from("task_mapping").select("id").eq("kpi_department", "Picking").eq("include_in_kpi", true),
        supabase.from("task_mapping").select("id").eq("kpi_department", "Expédition").eq("include_in_kpi", true),
      ]);
      const pickTaskIds = (pickTasks ?? []).map((t) => t.id);
      const expTaskIds = (expTasks ?? []).map((t) => t.id);
      const s8Pick = pickTaskIds.length
        ? fetchAllRows<S8Log>((from, to) =>
            supabase.from("s8_time_logs").select("employee_id, log_date, duration_minutes")
              .in("task_mapping_id", pickTaskIds).gte("log_date", monthStart).lte("log_date", monthEnd).range(from, to)
          )
        : Promise.resolve({ data: [] as S8Log[], error: null });
      const s8Exp = expTaskIds.length
        ? fetchAllRows<S8Log>((from, to) =>
            supabase.from("s8_time_logs").select("employee_id, log_date, duration_minutes")
              .in("task_mapping_id", expTaskIds).gte("log_date", monthStart).lte("log_date", monthEnd).range(from, to)
          )
        : Promise.resolve({ data: [] as S8Log[], error: null });

      if (source === "wrapper") {
        const [parts, pickS8, expS8] = await Promise.all([
          Promise.all(
            monthList.map(async (ym) => {
              const [pick, pack] = await Promise.all([
                fetchSapKpiMonth("picking", ym) as Promise<{
                  days: PickingDailyRow[];
                  waves: PickingWaveRow[];
                }>,
                fetchSapKpiMonth("packaging", ym) as Promise<{ days: PackagingDailyRow[] }>,
              ]);
              return { pick, pack };
            })
          ),
          s8Pick,
          s8Exp,
        ]);
        setPickRows(parts.flatMap((p) => p.pick.days ?? []));
        setPackRows(parts.flatMap((p) => p.pack.days ?? []));
        setWaveRows(parts.flatMap((p) => p.pick.waves ?? []));
        setPickLogs(pickS8.data.filter((l) => l.employee_id));
        setExpLogs(expS8.data.filter((l) => l.employee_id));
        setLoading(false);
        return;
      }

      const sapCols =
        "id, employee_id, external_user_code, external_user_name, doc_date, period_month, line_count, wave_count, picklist_count";
      const [pickSap, packSap, pickS8, expS8, waves] = await Promise.all([
        fetchAllRows<PickingDailyRow>((from, to) =>
          supabase.from("picking_daily_counts").select(sapCols).in("period_month", monthList).range(from, to)
        ),
        fetchAllRows<PackagingDailyRow>((from, to) =>
          supabase.from("packaging_daily_counts").select(sapCols).in("period_month", monthList).range(from, to)
        ),
        s8Pick,
        s8Exp,
        fetchPickingWaveStatsFrom(supabase, oldest).then((all) =>
          all.filter((w) => monthList.includes(w.period_month))
        ),
      ]);
      setPickRows(pickSap.data);
      setPackRows(packSap.data);
      setWaveRows(waves);
      setPickLogs(pickS8.data.filter((l) => l.employee_id));
      setExpLogs(expS8.data.filter((l) => l.employee_id));
      setLoading(false);
      return;
    }

    const priors = priorAvailableMonths(selectedMonth, months, 4);
    const [curData, ...priorData] = await Promise.all([
      fetchWarehouseMonth(supabase, selectedMonth),
      ...priors.map((ym) => fetchWarehouseMonth(supabase, ym)),
    ]);
    setPickRows(curData.pickRows);
    setPackRows(curData.packRows);
    setWaveRows(curData.waveRows);
    setPickLogs(curData.pickLogs);
    setExpLogs(curData.expLogs);
    const priorTeams = priorData.map((d, i) =>
      computeWarehouseTeam(d.pickRows, d.packRows, d.pickLogs, d.expLogs, d.waveRows, priors[i])
    );
    setPrevTeam(priorTeams[0] ?? null);
    setRolling(rollingBenchmark(priorTeams.slice(0, 3)));
    setPreviousRolling(
      priorTeams.length > 1 ? rollingBenchmark(priorTeams.slice(1, 4)) : null
    );
    setLoading(false);
  }, [selectedMonth, months]);

  useEffect(() => { loadMeta().then(() => setLoading(false)); }, [loadMeta]);
  useEffect(() => { if (selectedMonth) loadData(); }, [selectedMonth, loadData]);

  const team = useMemo(
    () =>
      computeWarehouseTeam(
        pickRows,
        packRows,
        pickLogs,
        expLogs,
        waveRows,
        isLast12 ? undefined : selectedMonth
      ),
    [pickRows, packRows, pickLogs, expLogs, waveRows, isLast12, selectedMonth]
  );

  const employees = useMemo(
    () => computeWarehouseEmployees(pickRows, packRows, pickLogs, expLogs, employeeNames),
    [pickRows, packRows, pickLogs, expLogs, employeeNames]
  );

  const offenders = useMemo(() => topMislogOffenders(employees.list), [employees.list]);
  const named = employees.list.filter((e) => !e.isGeneric);
  const generic = employees.list.filter((e) => e.isGeneric);

  const empty = pickRows.length === 0 && packRows.length === 0 && pickLogs.length === 0 && expLogs.length === 0;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title="KPI — Expédition"
        subtitle={
          isLast12 || !selectedMonth
            ? "Volume SAP · rythme picking sur jours propres"
            : `${monthLabel(selectedMonth)} · rythme vs moyenne récente`
        }
      />

      {months.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
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
      ) : empty ? (
        <div className="text-center py-16 text-slate-400">
          Aucune donnée pour cette période. Importez picking SAP, emballage SAP et logs S8.
        </div>
      ) : (
        <>
          {!isLast12 && (
            <WarehouseTeamCards
              current={team}
              previous={prevTeam}
              rolling={rolling}
              previousRolling={previousRolling}
            />
          )}
          {isLast12 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500 mb-1">Volume SAP</p>
                <p className="text-2xl font-bold text-slate-800">{team.totalLines.toLocaleString("fr-CA")}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500 mb-1">L/h picking équipe</p>
                <p className="text-2xl font-bold text-slate-800">{team.teamPickLinesPerHour != null ? team.teamPickLinesPerHour.toFixed(1) : "—"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500 mb-1">Picking mal loggé</p>
                <p className="text-2xl font-bold text-slate-800">{team.misloggedPct.toFixed(0)}%</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500 mb-1">Heures plancher</p>
                <p className="text-2xl font-bold text-slate-800">{formatHours(team.floorHours)}</p>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl mb-6 overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-5 py-4 hover:bg-slate-50 text-left"
              onClick={() => setLogOpen((v) => !v)}
            >
              <AlertCircle className={cn(
                "w-4 h-4 shrink-0",
                team.misloggedPct > 20 ? "text-amber-600" : "text-slate-400"
              )} />
              <h3 className="text-sm font-semibold text-slate-700">Intégrité des logs</h3>
              <span className="ml-auto text-xs text-slate-500 mr-2">
                {team.misloggedPickLines.toLocaleString("fr-CA")} lig. picking sous log Expédition
                {team.unmatchedPickLines > 0 && ` · ${team.unmatchedPickLines.toLocaleString("fr-CA")} sans aucun log`}
              </span>
              {logOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {logOpen && (
              <div className="px-5 pb-5 border-t border-slate-100">
                <p className="text-xs text-slate-500 mt-3 mb-3">
                  Le volume SAP est fiable. Le rythme (l/h) n&apos;utilise que les jours avec lignes pick
                  + log <strong>Picking</strong> ≥ 30 min, et exclut les journées ≥ {MAX_FLOOR_HOURS_PER_DAY} h
                  plancher (log impossible).
                </p>
                {offenders.length > 0 && (
                  <div className="space-y-1.5">
                    {offenders.map((o) => (
                      <div key={o.key} className="flex items-center gap-2 text-xs">
                        <div
                          className="h-2 bg-amber-400 rounded-sm shrink-0"
                          style={{
                            width: `${Math.max(4, (o.misloggedPickLines / (offenders[0]?.misloggedPickLines ?? 1)) * 160)}px`,
                          }}
                        />
                        <span className="text-slate-700 font-medium">{o.displayName}</span>
                        <span className="text-slate-400 ml-auto">
                          {o.misloggedPickLines.toLocaleString("fr-CA")} lig.
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <EmployeeTable
            title={`Équipe (${named.length})`}
            list={named}
            avg={team.teamPickLinesPerHour}
            isLast12={isLast12}
            expandedKey={expandedKey}
            setExpandedKey={setExpandedKey}
            pickRows={pickRows}
            packRows={packRows}
            pickLogs={pickLogs}
            expLogs={expLogs}
          />

          {generic.length > 0 && (
            <div className="mt-6">
              <EmployeeTable
                title={`Comptes génériques / non mappés (${generic.length})`}
                subtitle="Exclus du classement et de la moyenne l/h"
                list={generic}
                avg={null}
                isLast12={isLast12}
                expandedKey={expandedKey}
                setExpandedKey={setExpandedKey}
                pickRows={pickRows}
                packRows={packRows}
                pickLogs={pickLogs}
                expLogs={expLogs}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Flat 8-column grid — gap-x-0 so same-group cells are touching and share a background band.
// vs-équipe gets 86px so it never wraps.
const FLAT_GRID = "sm:grid-cols-[minmax(0,1fr)_82px_82px_82px_82px_86px_62px_36px]";

// Pale slate tints — just enough to hint at grouping without distraction
const BG_PICK = "bg-slate-50";
const BG_PACK = "bg-slate-100/70";

const EMPLOYEE_TABLE_HELP = {
  pick:
    "Calcul : somme des lignes SAP picking de l’employé sur la période.\nInclus : tout le volume pick SAP.\nExclus : emballage.\nVolume brut, pas un score de rythme.",
  pickRate:
    `Calcul : lignes pick ÷ heures Picking des jours « éligibles ».\nUn jour compte si : ≥1 ligne pick SAP + bloc TWMS Picking ≥30 min + plancher < ${MAX_FLOOR_HOURS_PER_DAY} h.\nExclus : jours sans pick, blocs <30 min, jours ≥${MAX_FLOOR_HOURS_PER_DAY} h, heures Expédition.\n« — » si compte générique ou aucun jour éligible.`,
  pack:
    "Calcul : somme des lignes SAP emballage de l’employé sur la période.\nInclus : tout le volume emb. SAP.\nExclus : picking.",
  packRate:
    `Calcul : lignes emb. ÷ heures Expédition des jours « éligibles ».\nUn jour compte si : ≥1 ligne emb. SAP + bloc TWMS Expédition ≥30 min + plancher < ${MAX_FLOOR_HOURS_PER_DAY} h.\nExclus : jours sans emb., blocs <30 min, jours ≥${MAX_FLOOR_HOURS_PER_DAY} h.\n« — » si compte générique ou aucun jour éligible.`,
  vsTeam:
    "Calcul : (l/h pick de l’employé − l/h picking équipe) ÷ l/h picking équipe × 100.\nRéférence = carte « L/h picking équipe » (ratio global équipe, pas la moyenne des individus).\n+22 % = 22 % plus rapide que l’équipe · −18 % = plus lent.\nUniquement sur le picking (pas l’emballage).",
  success:
    "Calcul : (lignes totales − lignes exclues pour log) ÷ lignes totales × 100.\nExclus du numérateur : pick mal loggé (sous Expédition), pick sans log, emb. sous Picking, journées ≥10 h.\nPas exclus : jours <30 min (impactent seulement le l/h, pas le succès).",
  log:
    "Alerte si au moins un problème de log sur la période : pick sous Expédition, pick sans log, emb. sous Picking, ou journée ≥10 h.\nCliquer la ligne pour le détail jour par jour.",
};

function ColumnHeader({
  label,
  help,
  align = "right",
}: {
  label: string;
  help: string;
  align?: "left" | "right" | "center";
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={cn(
          "w-full text-[11px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap",
          "border-b border-dotted border-transparent hover:border-slate-300 hover:text-slate-600 cursor-help",
          align === "right" && "text-right",
          align === "left" && "text-left",
          align === "center" && "text-center"
        )}
        aria-label={`Aide : ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
      >
        {label}
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-50 top-full mt-1.5 min-w-[240px] max-w-[280px] rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg",
            "text-[11px] normal-case font-normal tracking-normal text-slate-600 leading-relaxed whitespace-pre-line",
            align === "right" && "right-0",
            align === "left" && "left-0",
            align === "center" && "left-1/2 -translate-x-1/2"
          )}
        >
          {help}
        </div>
      )}
    </div>
  );
}

// Mobile stacked groups (unchanged UX on small screens)
function MobileGroup({
  label,
  bg,
  children,
  cols = 2,
}: {
  label: string;
  bg: string;
  children: ReactNode;
  cols?: 2 | 3;
}) {
  return (
    <div className={cn(
      "sm:hidden rounded-lg border border-slate-200 px-3 py-2 items-center",
      cols === 2 ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2",
      bg,
    )}>
      <p className={cn("text-[10px] font-semibold uppercase tracking-wide text-slate-500 text-center mb-1 pb-1 border-b border-slate-200",
        cols === 2 ? "col-span-2" : "col-span-3")}>
        {label}
      </p>
      {children}
    </div>
  );
}

function EmployeeTable({
  title,
  subtitle,
  list,
  avg,
  isLast12,
  expandedKey,
  setExpandedKey,
  pickRows,
  packRows,
  pickLogs,
  expLogs,
}: {
  title: string;
  subtitle?: string;
  list: ReturnType<typeof computeWarehouseEmployees>["list"];
  avg: number | null;
  isLast12: boolean;
  expandedKey: string | null;
  setExpandedKey: (k: string | null) => void;
  pickRows: PickingDailyRow[];
  packRows: PackagingDailyRow[];
  pickLogs: S8Log[];
  expLogs: S8Log[];
}) {
  // Helper: flat cell with optional group background tint + right separator border
  const Cell = ({
    children,
    bg,
    sep,
    className: cls,
  }: {
    children: ReactNode;
    bg?: string;
    sep?: boolean;
    className?: string;
  }) => (
    <div className={cn(
      "hidden sm:flex items-center justify-end px-2.5 self-stretch",
      bg,
      sep && "border-r-2 border-slate-300",
      cls,
    )}>
      {children}
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">
          {title}
          {subtitle && <span className="font-normal text-slate-500 ml-2">· {subtitle}</span>}
        </h3>
      </div>

      {/* Desktop header — 2 rows: group labels then column names */}
      <div
        className={cn("hidden sm:grid gap-x-0 px-5 border-b border-slate-200", FLAT_GRID)}
        style={{ gridTemplateRows: "auto auto" }}
      >
        {/* Row 1 — group label spans. Only border-r on the RIGHT side of each group — never border-l. */}
        <div style={{ gridColumn: 1, gridRow: 1 }} />
        <div
          className={cn("text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600 pt-2 pb-1 border-b border-r-2 border-slate-300", BG_PICK)}
          style={{ gridColumn: "2 / 4", gridRow: 1 }}
        >
          Picking
        </div>
        <div
          className={cn("text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600 pt-2 pb-1 border-b border-r-2 border-slate-300", BG_PACK)}
          style={{ gridColumn: "4 / 6", gridRow: 1 }}
        >
          Emballage
        </div>
        <div
          className="text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 pt-2 pb-1 border-b border-slate-200"
          style={{ gridColumn: "6 / 9", gridRow: 1 }}
        >
          Qualité
        </div>

        {/* Row 2 — column headers. border-r only on last col of each group (3 and 5). */}
        <span
          className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 pb-2 self-end"
          style={{ gridColumn: 1, gridRow: 2 }}
        >
          Employé
        </span>
        <div className={cn("px-2.5 pb-2 pt-0.5 flex items-end justify-end", BG_PICK)} style={{ gridColumn: 2, gridRow: 2 }}>
          <ColumnHeader label="Pick" help={EMPLOYEE_TABLE_HELP.pick} />
        </div>
        <div className={cn("px-2.5 pb-2 pt-0.5 flex items-end justify-end border-r-2 border-slate-300", BG_PICK)} style={{ gridColumn: 3, gridRow: 2 }}>
          <ColumnHeader label="l/h pick" help={EMPLOYEE_TABLE_HELP.pickRate} />
        </div>
        <div className={cn("px-2.5 pb-2 pt-0.5 flex items-end justify-end", BG_PACK)} style={{ gridColumn: 4, gridRow: 2 }}>
          <ColumnHeader label="Emb." help={EMPLOYEE_TABLE_HELP.pack} />
        </div>
        <div className={cn("px-2.5 pb-2 pt-0.5 flex items-end justify-end border-r-2 border-slate-300", BG_PACK)} style={{ gridColumn: 5, gridRow: 2 }}>
          <ColumnHeader label="l/h emb." help={EMPLOYEE_TABLE_HELP.packRate} />
        </div>
        <div className="px-2.5 pb-2 pt-0.5 flex items-end justify-end" style={{ gridColumn: 6, gridRow: 2 }}>
          <ColumnHeader label="vs équipe" help={EMPLOYEE_TABLE_HELP.vsTeam} />
        </div>
        <div className="px-2.5 pb-2 pt-0.5 flex items-end justify-end" style={{ gridColumn: 7, gridRow: 2 }}>
          <ColumnHeader label="Succès" help={EMPLOYEE_TABLE_HELP.success} />
        </div>
        <div className="px-2.5 pb-2 pt-0.5 flex items-end justify-center" style={{ gridColumn: 8, gridRow: 2 }}>
          <ColumnHeader label="Log" help={EMPLOYEE_TABLE_HELP.log} align="center" />
        </div>
      </div>

      <div className="divide-y divide-slate-200">
        {list.map((emp) => {
          const isOpen = expandedKey === emp.key;
          const vsAvg =
            emp.evaluable && emp.pickLinesPerHour != null && avg != null && avg > 0
              ? ((emp.pickLinesPerHour - avg) / avg) * 100
              : null;
          const hasLogIssue =
            emp.misloggedPickLines > 0 ||
            emp.unmatchedPickLines > 0 ||
            emp.packUnderPickDays > 0 ||
            emp.impossibleDays > 0;
          const days = isOpen
            ? computeWarehouseDays(pickRows, packRows, pickLogs, expLogs, emp.key)
            : [];

          const isEven = list.indexOf(emp) % 2 === 1;
          return (
            <div key={emp.key}>
              <button
                type="button"
                className={cn(
                  "w-full text-left",
                  "grid grid-cols-1 gap-2 px-5 py-3",
                  FLAT_GRID,
                  "sm:gap-x-0 sm:px-5 sm:py-0 sm:items-stretch",
                  isEven ? "sm:bg-slate-50/60 sm:hover:bg-slate-100/60" : "sm:hover:bg-slate-50"
                )}
                onClick={() => setExpandedKey(isOpen ? null : emp.key)}
              >
                {/* Name — always visible */}
                <div className="min-w-0 flex items-center gap-2 sm:pr-3 sm:py-3">
                  {isOpen
                    ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                  <p className="text-sm font-medium text-slate-700 truncate">{emp.displayName}</p>
                </div>

                {/* Pick group */}
                <Cell bg={BG_PICK}>
                  <Metric value={emp.pickLines.toLocaleString("fr-CA")} muted={emp.pickLines === 0} hint="pick" />
                </Cell>
                <Cell bg={BG_PICK} sep>
                  <Metric
                    value={emp.evaluable && emp.pickLinesPerHour != null ? emp.pickLinesPerHour.toFixed(1) : "—"}
                    muted={!emp.evaluable || emp.pickLinesPerHour == null}
                    hint="l/h pick"
                  />
                </Cell>

                {/* Pack group */}
                <Cell bg={BG_PACK}>
                  <Metric value={emp.packLines.toLocaleString("fr-CA")} muted={emp.packLines === 0} hint="emb." />
                </Cell>
                <Cell bg={BG_PACK} sep>
                  <Metric
                    value={emp.evaluablePack && emp.packLinesPerHour != null ? emp.packLinesPerHour.toFixed(1) : "—"}
                    muted={!emp.evaluablePack || emp.packLinesPerHour == null}
                    hint="l/h emb."
                  />
                </Cell>

                {/* Quality group */}
                <Cell>
                  <p className={cn(
                    "text-sm tabular-nums",
                    vsAvg == null ? "text-slate-300" : vsAvg < 0 ? "text-amber-700" : "text-slate-600"
                  )}>
                    {vsAvg == null ? "—" : `${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(0)}%`}
                  </p>
                </Cell>
                <Cell>
                  <p
                    className={cn(
                      "text-sm tabular-nums",
                      emp.successPct == null
                        ? "text-slate-300"
                        : emp.successPct >= 95
                          ? "text-slate-700"
                          : "text-amber-700"
                    )}
                    title={
                      emp.excludedLogLines > 0
                        ? `${emp.excludedLogLines.toLocaleString("fr-CA")} lignes exclues (log) / ${emp.totalLines.toLocaleString("fr-CA")}`
                        : undefined
                    }
                  >
                    {emp.successPct != null ? `${Math.round(emp.successPct)}%` : "—"}
                  </p>
                </Cell>
                <Cell className="justify-center">
                  {hasLogIssue ? (
                    <span className="inline-flex text-amber-700" title="Problème de log">
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span className="text-slate-200">·</span>
                  )}
                </Cell>

                {/* Mobile stacked groups */}
                <MobileGroup label="Picking" bg={BG_PICK}>
                  <Metric value={emp.pickLines.toLocaleString("fr-CA")} muted={emp.pickLines === 0} hint="pick" />
                  <Metric
                    value={emp.evaluable && emp.pickLinesPerHour != null ? emp.pickLinesPerHour.toFixed(1) : "—"}
                    muted={!emp.evaluable || emp.pickLinesPerHour == null}
                    hint="l/h pick"
                  />
                </MobileGroup>
                <MobileGroup label="Emballage" bg={BG_PACK}>
                  <Metric value={emp.packLines.toLocaleString("fr-CA")} muted={emp.packLines === 0} hint="emb." />
                  <Metric
                    value={emp.evaluablePack && emp.packLinesPerHour != null ? emp.packLinesPerHour.toFixed(1) : "—"}
                    muted={!emp.evaluablePack || emp.packLinesPerHour == null}
                    hint="l/h emb."
                  />
                </MobileGroup>
                <MobileGroup label="Qualité" bg="bg-slate-50" cols={3}>
                  <p className={cn("text-right text-sm tabular-nums", vsAvg == null ? "text-slate-300" : vsAvg < 0 ? "text-amber-700" : "text-slate-600")}>
                    {vsAvg == null ? "—" : `${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(0)}%`}
                  </p>
                  <p
                    className={cn("text-right text-sm tabular-nums", emp.successPct == null ? "text-slate-300" : emp.successPct >= 95 ? "text-slate-700" : "text-amber-700")}
                    title={emp.excludedLogLines > 0 ? `${emp.excludedLogLines.toLocaleString("fr-CA")} lignes exclues (log) / ${emp.totalLines.toLocaleString("fr-CA")}` : undefined}
                  >
                    {emp.successPct != null ? `${Math.round(emp.successPct)}%` : "—"}
                  </p>
                  <div className="flex justify-center">
                    {hasLogIssue
                      ? <span className="text-amber-700" title="Problème de log"><AlertTriangle className="w-3.5 h-3.5" /></span>
                      : <span className="text-slate-200">·</span>}
                  </div>
                </MobileGroup>
              </button>

              {isOpen && (
                <div className="px-5 pb-4 bg-slate-50 border-t border-slate-100">
                  <p className="text-xs text-slate-500 mt-3 mb-3">
                    {isLast12
                      ? `${emp.totalLines.toLocaleString("fr-CA")} lignes au total`
                      : `${emp.pickDays} j. picking · ${emp.packDays} j. emballage · ${emp.cleanDays} j. l/h pick · ${emp.cleanPackDays} j. l/h emb.`}
                    <span className="mx-2 text-slate-300">·</span>
                    TWMS Picking {formatHours(emp.pickHours)}
                    <span className="mx-2 text-slate-300">·</span>
                    Expédition {formatHours(emp.expHours)}
                    {emp.excludedLogLines > 0 && (
                      <>
                        <span className="mx-2 text-slate-300">·</span>
                        {emp.excludedLogLines.toLocaleString("fr-CA")} lig. exclues (log)
                      </>
                    )}
                  </p>
                  <p className="text-xs font-semibold text-slate-500 mb-2">Jour par jour</p>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left py-1 font-semibold">Jour</th>
                          <th className="text-right py-1 font-semibold">Pick SAP</th>
                          <th className="text-right py-1 font-semibold">Emb. SAP</th>
                          <th className="text-right py-1 font-semibold">h Picking</th>
                          <th className="text-right py-1 font-semibold">h Expéd.</th>
                          <th className="text-left py-1 pl-3 font-semibold">Problème</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {days.map((d) => {
                          const problems: string[] = [];
                          if (d.mislogged) problems.push("Pick sous Expédition");
                          if (d.unmatched) problems.push("Pick sans log");
                          if (d.packUnderPick) problems.push("Emb. sous Picking");
                          if (d.impossibleHours) {
                            problems.push(`Heures impossibles (≥${MAX_FLOOR_HOURS_PER_DAY} h)`);
                          }
                          return (
                            <tr
                              key={d.date}
                              className={problems.length > 0 ? "text-amber-800" : "text-slate-700"}
                            >
                              <td className="py-1">{formatDay(d.date)}</td>
                              <td className="py-1 text-right tabular-nums">{d.pickLines || "—"}</td>
                              <td className="py-1 text-right tabular-nums">{d.packLines || "—"}</td>
                              <td className="py-1 text-right tabular-nums">{d.pickHours > 0 ? formatHours(d.pickHours) : "—"}</td>
                              <td className="py-1 text-right tabular-nums">{d.expHours > 0 ? formatHours(d.expHours) : "—"}</td>
                              <td className="py-1 pl-3">{problems.join(" · ")}</td>
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
  );
}

function Metric({
  value,
  muted,
  hint,
}: {
  value: string;
  muted?: boolean;
  hint: string;
}) {
  return (
    <div className="text-right">
      <p className={cn(
        "text-base font-semibold tabular-nums leading-tight",
        muted ? "text-slate-300" : "text-slate-900"
      )}>
        {value}
      </p>
      <p className="text-[10px] text-slate-400 sm:hidden">{hint}</p>
    </div>
  );
}
