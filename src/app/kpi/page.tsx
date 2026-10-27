"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { WarehouseTeamCards } from "@/components/kpi/WarehouseTeamCards";
import { cn } from "@/lib/utils";
import type { PickingWaveRow } from "@/lib/picking";
import {
  computeWarehouseTeam,
  priorAvailableMonths,
  rollingBenchmark,
  type WarehouseTeamSummary,
} from "@/lib/warehouse";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { computeProductionSummary, formatMinutes, formatPct } from "@/lib/production";
import { fetchWarehouseMonth } from "@/lib/warehouseData";
import { fetchTwmsImportedMonths } from "@/lib/twmsMonths";

const MONTH_LABELS: Record<string, string> = {
  "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
  "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
  "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

function shortMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const names: Record<string, string> = {
    "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
    "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
    "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
  };
  return `${names[m ?? ""] ?? m} ${String(y).slice(2)}`;
}

function formatRate(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(1);
}

type Snapshot = { ym: string; team: WarehouseTeamSummary; waveRows: PickingWaveRow[] };

export default function KpiDashboardPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [prodVariance, setProdVariance] = useState<number | null>(null);
  const [prodActual, setProdActual] = useState<number | null>(null);

  const loadMonths = useCallback(async () => {
    // Seulement les mois avec logs TWMS importés (registre d'import)
    const unique = await fetchTwmsImportedMonths(supabase);
    setMonths(unique);
    setSelectedMonth((cur) => (cur && unique.includes(cur) ? cur : unique[0] || ""));
  }, []);

  const loadTrend = useCallback(async () => {
    if (months.length === 0) return;
    setLoading(true);
    const trendMonths = [...months].slice(0, 8).reverse();
    const rows = await Promise.all(
      trendMonths.map(async (ym) => {
        const d = await fetchWarehouseMonth(supabase, ym);
        return {
          ym,
          team: computeWarehouseTeam(d.pickRows, d.packRows, d.pickLogs, d.expLogs, d.waveRows, ym),
          waveRows: d.waveRows,
        };
      })
    );
    setSnapshots(rows);
    setLoading(false);
  }, [months]);

  useEffect(() => { loadMonths(); }, [loadMonths]);
  useEffect(() => { loadTrend(); }, [loadTrend]);

  useEffect(() => {
    if (!selectedMonth) return;
    let cancelled = false;
    fetchAllRows<{ actual_minutes: number; target_minutes: number | null; included_in_kpi: boolean; exclusion_reason: string | null }>(
      (from, to) =>
        supabase
          .from("production_actuals")
          .select("actual_minutes, target_minutes, included_in_kpi, exclusion_reason")
          .eq("period_month", selectedMonth)
          .range(from, to)
    ).then(({ data }) => {
      if (cancelled) return;
      const summary = computeProductionSummary(data);
      setProdActual(summary.includedLines > 0 ? summary.actualMinutes : null);
      setProdVariance(summary.targetMinutes > 0 ? summary.variancePct : null);
    });
    return () => { cancelled = true; };
  }, [selectedMonth]);

  const current = snapshots.find((s) => s.ym === selectedMonth)?.team ?? null;
  const previous = useMemo(() => {
    if (!selectedMonth) return null;
    const priors = priorAvailableMonths(selectedMonth, snapshots.map((s) => s.ym), 1);
    return snapshots.find((s) => s.ym === priors[0])?.team ?? null;
  }, [selectedMonth, snapshots]);

  const rolling = useMemo(() => {
    if (!selectedMonth) return null;
    const priors = priorAvailableMonths(selectedMonth, snapshots.map((s) => s.ym), 3);
    const teams = priors
      .map((ym) => snapshots.find((s) => s.ym === ym)?.team)
      .filter((t): t is WarehouseTeamSummary => t != null);
    return rollingBenchmark(teams);
  }, [selectedMonth, snapshots]);

  const previousRolling = useMemo(() => {
    if (!selectedMonth) return null;
    const prev = priorAvailableMonths(selectedMonth, snapshots.map((s) => s.ym), 1)[0];
    if (!prev) return null;
    const priors = priorAvailableMonths(prev, snapshots.map((s) => s.ym), 3);
    const teams = priors
      .map((ym) => snapshots.find((s) => s.ym === ym)?.team)
      .filter((t): t is WarehouseTeamSummary => t != null);
    return rollingBenchmark(teams);
  }, [selectedMonth, snapshots]);

  const maxLines = Math.max(1, ...snapshots.map((s) => s.team.totalLines));
  const rates = snapshots.map((s) => s.team.teamPickLinesPerHour).filter((r): r is number => r != null);
  const maxRate = Math.max(1, ...rates);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Dashboard KPI"
        subtitle={
          selectedMonth
            ? `${monthLabel(selectedMonth)} · rythme vs moyenne récente, volume = charge`
            : "Charge de travail vs performance d’équipe"
        }
      />

      {months.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
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
        </div>
      )}

      {loading || !current ? (
        <div className="text-center py-16 text-slate-400">Chargement…</div>
      ) : (
        <>
          <WarehouseTeamCards
            current={current}
            previous={previous}
            rolling={rolling}
            previousRolling={previousRolling}
          />

          {snapshots.length >= 2 && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-sm font-semibold text-slate-700 mb-1">Charge — lignes / mois</p>
                <p className="text-xs text-slate-400 mb-4">Pas un score d’équipe. Un mois plus bas = moins de commandes.</p>
                <div className="flex items-end gap-2 h-28">
                  {snapshots.map((t) => (
                    <button
                      key={t.ym}
                      onClick={() => setSelectedMonth(t.ym)}
                      className="flex-1 flex flex-col items-center gap-1 h-full justify-end group"
                      title={`${monthLabel(t.ym)} : ${t.team.totalLines.toLocaleString("fr-CA")} lig.`}
                    >
                      <span className="text-[10px] text-slate-500">
                        {t.team.totalLines > 0 ? (t.team.totalLines / 1000).toFixed(1) + "k" : "—"}
                      </span>
                      <div
                        className={cn(
                          "w-full rounded-t-md min-h-[4px] transition-colors",
                          t.ym === selectedMonth ? "bg-slate-600" : "bg-slate-200 group-hover:bg-slate-300"
                        )}
                        style={{ height: `${Math.max(6, (t.team.totalLines / maxLines) * 100)}%` }}
                      />
                      <span className={cn("text-[10px]", t.ym === selectedMonth ? "font-semibold text-slate-800" : "text-slate-400")}>
                        {shortMonth(t.ym)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-sm font-semibold text-slate-700 mb-1">Performance — l/h picking</p>
                <p className="text-xs text-slate-400 mb-4">
                  {rolling?.teamPickLinesPerHour != null
                    ? `Moyenne récente : ${formatRate(rolling.teamPickLinesPerHour)} l/h`
                    : "Comparable d’un mois à l’autre, même si le volume change."}
                </p>
                <div className="flex items-end gap-2 h-28">
                  {snapshots.map((t) => (
                    <button
                      key={t.ym}
                      onClick={() => setSelectedMonth(t.ym)}
                      className="flex-1 flex flex-col items-center gap-1 h-full justify-end group"
                      title={`${monthLabel(t.ym)} : ${formatRate(t.team.teamPickLinesPerHour)} l/h`}
                    >
                      <span className="text-[10px] text-slate-500">{formatRate(t.team.teamPickLinesPerHour)}</span>
                      <div
                        className={cn(
                          "w-full rounded-t-md min-h-[4px] transition-colors",
                          t.ym === selectedMonth ? "bg-primary" : "bg-primary/25 group-hover:bg-primary/40"
                        )}
                        style={{
                          height: `${Math.max(6, ((t.team.teamPickLinesPerHour ?? 0) / maxRate) * 100)}%`,
                        }}
                      />
                      <span className={cn("text-[10px]", t.ym === selectedMonth ? "font-semibold text-slate-800" : "text-slate-400")}>
                        {shortMonth(t.ym)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <Link
            href="/kpi/production"
            className="block bg-white border border-slate-200 rounded-xl p-5 mb-4 hover:border-slate-400 transition-colors"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Production · {monthLabel(selectedMonth)}</p>
            <p className="text-lg font-bold text-slate-900 mt-1">
              {prodActual == null ? "Pas de temps importé ce mois" : formatMinutes(prodActual)}
            </p>
            <p className="text-sm text-slate-600 mt-1">
              Écart vs cible (imputée) · {prodVariance == null ? "—" : formatPct(prodVariance)}
            </p>
          </Link>

          <Link href="/kpi/warehouse" className="block text-sm text-primary hover:underline">
            Voir le détail Expédition (employés, mix, logs) →
          </Link>
        </>
      )}
    </div>
  );
}
