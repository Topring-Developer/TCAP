"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import { computeProductionSummary, formatMinutes, formatPct } from "@/lib/production";
import { computeWarehouseTeam } from "@/lib/warehouse";
import { fetchWarehouseMonth, monthBounds } from "@/lib/warehouseData";
import { computeTeamReceivingSummary, type ReceivingDailyRow, type S8ReceivingLog } from "@/lib/receiving";
import { computeTeamSummary, type InventoryLine } from "@/lib/inventory";

const MONTH_LABELS: Record<string, string> = {
  "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
  "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
  "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

function rate(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v.toFixed(1)} /h`;
}

type Card = {
  href: string;
  title: string;
  lines: string;
  rateLabel: string;
  rate: string;
  note?: string;
};

export default function MonthlyKpiPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMonths = useCallback(async () => {
    const [{ data: pick }, { data: prod }] = await Promise.all([
      supabase.from("picking_daily_counts").select("period_month").order("period_month", { ascending: false }).limit(36),
      supabase.from("production_actuals").select("period_month").order("period_month", { ascending: false }).limit(36),
    ]);
    const unique = [...new Set([
      ...(pick ?? []).map((r) => r.period_month),
      ...(prod ?? []).map((r) => r.period_month),
    ])].filter(Boolean).sort().reverse();
    setMonths(unique);
    setSelectedMonth((cur) => cur || unique[0] || "");
  }, []);

  const load = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);
    const { start, end } = monthBounds(selectedMonth);

    const [
      warehouse,
      prodRows,
      recvTasks,
      recvEmps,
      invGoal,
    ] = await Promise.all([
      fetchWarehouseMonth(supabase, selectedMonth),
      fetchAllRows<{ actual_minutes: number; target_minutes: number | null; included_in_kpi: boolean; exclusion_reason: string | null }>(
        (from, to) =>
          supabase
            .from("production_actuals")
            .select("actual_minutes, target_minutes, included_in_kpi, exclusion_reason")
            .eq("period_month", selectedMonth)
            .range(from, to)
      ),
      supabase.from("task_mapping").select("id").eq("kpi_department", "Réception").eq("include_in_kpi", true),
      supabase.from("employees").select("id, include_in_receiving_kpi").eq("is_active", true),
      supabase.from("inventory_team_settings").select("lines_per_employee_per_month").order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const team = computeWarehouseTeam(
      warehouse.pickRows,
      warehouse.packRows,
      warehouse.pickLogs,
      warehouse.expLogs,
      warehouse.waveRows,
      selectedMonth
    );
    const prod = computeProductionSummary(prodRows.data);

    const included = new Set(
      (recvEmps.data ?? []).filter((e) => e.include_in_receiving_kpi !== false).map((e) => e.id)
    );
    const taskIds = (recvTasks.data ?? []).map((t) => t.id);
    const [recvSap, recvS8, invRows] = await Promise.all([
      fetchAllRows<ReceivingDailyRow>((from, to) =>
        supabase
          .from("receiving_daily_counts")
          .select("id, employee_id, external_user_name, doc_date, period_month, line_count")
          .eq("period_month", selectedMonth)
          .range(from, to)
      ),
      taskIds.length > 0
        ? fetchAllRows<S8ReceivingLog>((from, to) =>
            supabase
              .from("s8_time_logs")
              .select("employee_id, log_date, duration_minutes")
              .in("task_mapping_id", taskIds)
              .gte("log_date", start)
              .lte("log_date", end)
              .range(from, to)
          )
        : Promise.resolve({ data: [] as S8ReceivingLog[], error: null }),
      fetchAllRows<InventoryLine>((from, to) =>
        supabase
          .from("inventory_count_lines")
          .select("id, employee_id, external_user_name, external_user_code, count_date, period_month, item_code, location, has_discrepancy")
          .eq("period_month", selectedMonth)
          .range(from, to)
      ),
    ]);

    const recv = computeTeamReceivingSummary(
      recvSap.data.filter((r) => r.employee_id && included.has(r.employee_id)),
      recvS8.data.filter((l) => l.employee_id && included.has(l.employee_id))
    );
    const goal = invGoal.data?.lines_per_employee_per_month ?? 500;
    const inv = computeTeamSummary(invRows.data, goal);
    const packRate = team.expHours > 0 ? team.packLines / team.expHours : null;

    setCards([
      {
        href: "/kpi/production",
        title: "Production",
        lines: formatMinutes(prod.actualMinutes),
        rateLabel: "Écart vs cible",
        rate: prod.targetMinutes > 0 ? formatPct(prod.variancePct) : "—",
        note: "Même agrégat que KPI Production. Temps réel du mois.",
      },
      {
        href: "/kpi/picking",
        title: "Picking",
        lines: `${team.pickLines.toLocaleString("fr-CA")} lignes`,
        rateLabel: "Lignes/h",
        rate: rate(team.teamPickLinesPerHour),
      },
      {
        href: "/kpi/warehouse",
        title: "Emballage",
        lines: `${team.packLines.toLocaleString("fr-CA")} lignes`,
        rateLabel: "Lignes/h",
        rate: rate(packRate),
        note: "Lignes SAP ÷ heures TWMS Expédition.",
      },
      {
        href: "/kpi/receiving",
        title: "Réception",
        lines: `${recv.totalLines.toLocaleString("fr-CA")} lignes`,
        rateLabel: "Lignes/h",
        rate: rate(recv.linesPerHour),
      },
      {
        href: "/kpi/inventory",
        title: "Inventaire",
        lines: `${inv.totalLines.toLocaleString("fr-CA")} lignes`,
        rateLabel: "vs objectif",
        rate: `${inv.goalProgressPct.toFixed(0)} %`,
      },
    ]);
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => { loadMonths(); }, [loadMonths]);
  useEffect(() => { if (selectedMonth) load(); }, [selectedMonth, load]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Résumé du mois"
        subtitle="Les KPI déjà calculés, pour le mois choisi. Aucun nouveau calcul."
      />

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
        </div>
      )}

      {loading ? (
        <p className="text-slate-400 py-16 text-center">Chargement…</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {cards.map((card) => (
            <Link
              key={card.href + card.title}
              href={card.href}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-400 transition-colors"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{card.title}</p>
              <p className="text-2xl font-bold text-slate-900 mt-2">{card.lines}</p>
              <p className="text-sm text-slate-600 mt-1">
                {card.rateLabel} · <span className="font-semibold">{card.rate}</span>
              </p>
              {card.note && <p className="text-xs text-slate-400 mt-2">{card.note}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
