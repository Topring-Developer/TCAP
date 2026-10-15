"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Select } from "@/components/ui/Select";
import {
  computeLogQuality,
  computeTeamPickingSummary,
  type PickingDailyRow,
  type PickingWaveRow,
  type S8PickingLog,
} from "@/lib/picking";
import { monthsFrom } from "@/lib/sap/source";

const MONTH_SHORT: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

type MetricKey = "lines" | "linesPerHour" | "waves" | "picklists" | "unmatchedPct";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "lines", label: "Lignes pickées" },
  { key: "linesPerHour", label: "Lignes / heure équipe" },
  { key: "waves", label: "Vagues" },
  { key: "picklists", label: "Picklists" },
  { key: "unmatchedPct", label: "% lignes sans temps S8" },
];

const chartConfig = {
  value: {
    label: "Valeur",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

type MonthPoint = {
  ym: string;
  label: string;
  lines: number;
  linesPerHour: number | null;
  waves: number;
  picklists: number;
  unmatchedPct: number;
};

function logMonth(logDate: string): string {
  return logDate.slice(0, 7);
}

function buildSeries(
  sapRows: PickingDailyRow[],
  s8Logs: S8PickingLog[],
  waveRows: PickingWaveRow[],
  employeeNames: Map<string, string>
): MonthPoint[] {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
  const keys = monthsFrom(cutoffMonth);

  return keys.map((ym) => {
    const sap = sapRows.filter((r) => r.period_month === ym);
    const waves = waveRows.filter((w) => w.period_month === ym);
    const logs = s8Logs.filter((l) => logMonth(l.log_date) === ym);
    const team = computeTeamPickingSummary(sap, logs, waves, ym);
    const quality = computeLogQuality(sap, logs, employeeNames);
    const [y, m] = ym.split("-");
    return {
      ym,
      label: `${MONTH_SHORT[m ?? ""] ?? m} ${y?.slice(2) ?? ""}`,
      lines: team.totalLines,
      linesPerHour: team.linesPerHour,
      waves: team.totalWaves,
      picklists: team.totalPicklists,
      unmatchedPct: quality.unmatchedPct,
    };
  });
}

export function PickingAnnualChart({
  sapRows,
  s8Logs,
  waveRows,
  employeeNames,
}: {
  sapRows: PickingDailyRow[];
  s8Logs: S8PickingLog[];
  waveRows: PickingWaveRow[];
  employeeNames: Map<string, string>;
}) {
  const [metric, setMetric] = useState<MetricKey>("lines");

  const series = useMemo(
    () => buildSeries(sapRows, s8Logs, waveRows, employeeNames),
    [sapRows, s8Logs, waveRows, employeeNames]
  );

  const chartData = useMemo(
    () =>
      series.map((row) => ({
        label: row.label,
        value: row[metric] ?? 0,
      })),
    [series, metric]
  );

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? "";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Progression — 12 derniers mois</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Courbe mensuelle · choisissez une métrique pour afficher la tendance
          </p>
        </div>
        <div className="w-56">
          <Select
            label="Métrique"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
          >
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="min-h-[260px] w-full aspect-auto">
        <LineChart accessibilityLayer data={chartData} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) =>
              metric === "unmatchedPct"
                ? `${Number(v).toFixed(0)}%`
                : Number(v).toLocaleString("fr-CA", { maximumFractionDigits: 1 })
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const month = payload?.[0]?.payload?.label as string | undefined;
                  return month ? `${metricLabel} · ${month}` : metricLabel;
                }}
                formatter={(value) => {
                  const n = Number(value);
                  const text =
                    metric === "unmatchedPct"
                      ? `${n.toFixed(1)} %`
                      : metric === "linesPerHour"
                        ? n.toFixed(1)
                        : n.toLocaleString("fr-CA");
                  return (
                    <span className="font-mono font-medium text-foreground">{text}</span>
                  );
                }}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--color-value)" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
