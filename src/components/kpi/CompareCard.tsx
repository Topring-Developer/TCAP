"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function deltaPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Écart en points de pourcentage (ex. +10% vs +1% → +9 pts). */
export function deltaPoints(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}

function CompareRow({
  label,
  value,
  current,
  benchmark,
  higherIsBetter,
  mode = "relative",
}: {
  label: string;
  value: string;
  current: number | null;
  benchmark: number | null;
  higherIsBetter: boolean;
  mode?: "relative" | "points";
}) {
  const d = mode === "points" ? deltaPoints(current, benchmark) : deltaPct(current, benchmark);
  const better = d != null && (higherIsBetter ? d > 0.5 : d < -0.5);
  const worse = d != null && (higherIsBetter ? d < -0.5 : d > 0.5);

  return (
    <div className="grid grid-cols-[1fr_auto_3.5rem] items-baseline gap-3 py-1">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 tabular-nums">{value}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums text-right",
          better && "text-emerald-600",
          worse && "text-amber-600",
          !better && !worse && "text-slate-400"
        )}
      >
        {d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(0)}${mode === "points" ? " pts" : "%"}`}
      </span>
    </div>
  );
}

export function CompareCard({
  label,
  value,
  valueSub,
  numericCurrent,
  higherIsBetter = true,
  tone = "performance",
  help,
  rollingLabel = "Moy. 3 mois",
  rollingDisplay,
  rollingNumeric,
  momDisplay,
  momNumeric,
  momCurrent,
  momMode = "relative",
  rollingMode = "relative",
}: {
  label: string;
  value: string;
  /** Ligne secondaire sous la valeur (ex. 2e moyenne). */
  valueSub?: string;
  numericCurrent: number | null;
  higherIsBetter?: boolean;
  tone?: "performance" | "context";
  help?: string;
  rollingLabel?: string;
  rollingDisplay?: string;
  rollingNumeric?: number | null;
  momDisplay?: string;
  momNumeric?: number | null;
  momCurrent?: number | null;
  momMode?: "relative" | "points";
  rollingMode?: "relative" | "points";
}) {
  const [pinned, setPinned] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const dRoll =
    rollingMode === "points"
      ? deltaPoints(numericCurrent, rollingNumeric ?? null)
      : deltaPct(numericCurrent, rollingNumeric ?? null);
  const better = tone === "performance" && dRoll != null && (higherIsBetter ? dRoll > 0.5 : dRoll < -0.5);
  const worse = tone === "performance" && dRoll != null && (higherIsBetter ? dRoll < -0.5 : dRoll > 0.5);
  const hasDetail = rollingDisplay != null || momDisplay != null;

  return (
    <div
      className={cn(
        "group relative rounded-xl border p-4 text-left w-full",
        better ? "bg-emerald-50 border-emerald-100" :
        worse ? "bg-amber-50 border-amber-100" :
        "bg-white border-slate-200",
        (hasDetail || help) && "hover:z-40"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {help && (
          <button
            type="button"
            className="shrink-0 rounded-full text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Aide : ${label}`}
            title="Explication du calcul"
            onClick={(e) => {
              e.stopPropagation();
              setHelpOpen((v) => !v);
              setPinned(false);
            }}
            onBlur={() => setHelpOpen(false)}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <button
        type="button"
        className="w-full text-left"
        onClick={() => hasDetail && setPinned((v) => !v)}
        onBlur={() => setPinned(false)}
        onMouseLeave={() => setPinned(false)}
      >
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        {valueSub && (
          <p className="text-sm font-semibold text-slate-600 mt-0.5 tabular-nums">{valueSub}</p>
        )}
      </button>

      {helpOpen && help && (
        <div className="absolute z-40 left-0 right-0 top-full mt-1.5 min-w-[260px] rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg text-xs text-slate-600 leading-relaxed whitespace-pre-line">
          {help}
        </div>
      )}

      {hasDetail && !helpOpen && (
        <div
          className={cn(
            "absolute z-30 left-0 right-0 top-full mt-1.5 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg",
            "opacity-0 invisible pointer-events-none",
            "group-hover:opacity-100 group-hover:visible",
            pinned && "opacity-100 visible pointer-events-auto"
          )}
        >
          {rollingDisplay != null && (
            <CompareRow
              label={rollingLabel}
              value={rollingDisplay}
              current={numericCurrent}
              benchmark={rollingNumeric ?? null}
              higherIsBetter={higherIsBetter}
              mode={rollingMode}
            />
          )}
          {momDisplay != null && (
            <CompareRow
              label="Mois préc."
              value={momDisplay}
              current={momCurrent ?? numericCurrent}
              benchmark={momNumeric ?? null}
              higherIsBetter={higherIsBetter}
              mode={momMode}
            />
          )}
        </div>
      )}
    </div>
  );
}
