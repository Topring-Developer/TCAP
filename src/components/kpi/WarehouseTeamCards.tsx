"use client";

import { useState } from "react";
import { CompareCard } from "@/components/kpi/CompareCard";
import { cn } from "@/lib/utils";
import {
  buildWarehouseVerdict,
  hoursLoadRatio,
  MAX_FLOOR_HOURS_PER_DAY,
  type RollingBenchmark,
  type WarehouseTeamSummary,
} from "@/lib/warehouse";
import { formatAvgLinesPerWave, formatAvgPicklistsPerWave, formatDualWaveAvg } from "@/lib/picking";

function formatHours(h: number): string {
  if (h <= 0) return "0 h";
  return `${h.toFixed(0)} h`;
}

function formatRate(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(1);
}

function formatLoadPct(ratio: number | null): string {
  if (ratio == null) return "—";
  const pct = (ratio - 1) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function loadPct(ratio: number | null): number | null {
  if (ratio == null) return null;
  return (ratio - 1) * 100;
}

const HELP = {
  linesPerDay:
    "Calcul : (lignes pick SAP + emb. SAP) ÷ jours avec au moins 1 ligne.\nInclus : tout le volume SAP.\nExclus : rien.\nIndicateur de charge (commandes), pas un score d’équipe.",
  volume:
    "Calcul : somme des lignes SAP picking + emballage du mois.\nInclus : tout le monde (mappé ou non).\nExclus : rien.\nC’est la demande / l’output, pas la performance.",
  pickLines:
    "Calcul : somme des lignes SAP picking du mois.\nInclus : toutes les lignes pick.\nExclus : lignes emballage.",
  packLines:
    "Calcul : somme des lignes SAP emballage du mois.\nInclus : toutes les lignes emb.\nExclus : lignes picking.",
  waves:
    "Calcul : nombre de WaveKey distincts lancés dans le mois (import SAP).\nChaque vague compte une fois, même si plusieurs employés y participent.",
  picklists:
    "Calcul : somme des picklists distinctes dans toutes les vagues du mois.\nIndicateur de volume, pas une moyenne.",
  linesPerWave:
    "Deux moyennes :\n• Grand chiffre = toutes les vagues lancées.\n• Sous-ligne « hors 1 PL » = hors vagues qui n’ont qu’une seule picklist.\nArrondi à l’unité.",
  picklistsPerWave:
    "Deux moyennes :\n• Grand chiffre = toutes les vagues.\n• Sous-ligne « hors 1 PL » = hors vagues à 1 seule picklist.\n2 décimales.",
  rate:
    `Calcul : lignes pick ÷ heures Picking des jours « éligibles ».\nUn jour compte si : ≥1 ligne pick SAP + bloc TWMS Picking ≥30 min + plancher < ${MAX_FLOOR_HOURS_PER_DAY} h.\nExclus : jours sans pick, blocs <30 min, jours ≥${MAX_FLOOR_HOURS_PER_DAY} h, heures Expédition, emballage.`,
  load:
    "Calcul : (heures/jour ÷ heures/jour de référence) ÷ (lignes/jour ÷ lignes/jour de référence).\nRéférence = moyenne heures/jour et lignes/jour des 3 mois précédents — pas la moyenne des % (mai +8, juin +1, etc.).\nLe % affiché est déjà vs cette référence (0 % = heures proportionnelles à la charge).\nVert = sous la référence (moins d’heures que la charge) · ambre = au-dessus.\nMois préc. = le même score qu’affichait ce mois-là.",
  mislog:
    "Calcul : lignes pick des jours « Pick sous Expédition » ÷ toutes les lignes pick × 100.\nJour mal loggé = pick SAP + 0 h Picking + heures Expédition.\nPas inclus : pick sans log, emb. sous Picking, jours ≥10 h.",
  floor:
    "Calcul : toutes les heures TWMS Picking + Expédition du mois.\nInclus : tout, même les journées ≥10 h.\nContexte (masse salariale / présence), pas un score de rythme.",
};

export function WarehouseTeamCards({
  current,
  previous,
  rolling,
  previousRolling,
}: {
  current: WarehouseTeamSummary;
  previous: WarehouseTeamSummary | null;
  rolling: RollingBenchmark | null;
  /** Benchmark utilisé pour le score « Heures vs charge » du mois précédent (ses 3 mois à elle). */
  previousRolling?: RollingBenchmark | null;
}) {
  const [avisOpen, setAvisOpen] = useState(false);
  const bench = rolling ?? (previous
    ? {
        monthCount: 1,
        totalLines: previous.totalLines,
        pickLines: previous.pickLines,
        packLines: previous.packLines,
        pickWaves: previous.pickWaves,
        pickPicklists: previous.pickPicklists,
        linesPerWave: previous.linesPerWave,
        picklistsPerWave: previous.picklistsPerWave,
        linesPerWaveExclSinglePl: previous.linesPerWaveExclSinglePl,
        picklistsPerWaveExclSinglePl: previous.picklistsPerWaveExclSinglePl,
        floorHours: previous.floorHours,
        pickHours: previous.pickHours,
        teamPickLinesPerHour: previous.teamPickLinesPerHour,
        misloggedPct: previous.misloggedPct,
        workingDays: previous.workingDays,
        linesPerDay: previous.linesPerDay,
        hoursPerDay: previous.hoursPerDay,
        peopleCount: previous.peopleCount,
      }
    : null);

  const prevBench = previousRolling ?? null;

  const n = bench?.monthCount ?? 0;
  const rollingLabel = n >= 2 ? `Moy. ${n} mois` : "Moy. récente";
  const vsText = n >= 2 ? `la moyenne des ${n} derniers mois` : "le mois précédent";
  const verdict = buildWarehouseVerdict(current, bench, vsText);

  const loadRatio = bench ? hoursLoadRatio(current, bench) : null;
  const currentLoadPct = loadPct(loadRatio);
  const previousLoadRatio = previous && prevBench ? hoursLoadRatio(previous, prevBench) : null;
  const previousLoadPct = loadPct(previousLoadRatio);

  const daysNote =
    current.workingDays > 0
      ? `${current.workingDays} j. travaillés${
          bench && Math.abs(current.workingDays - bench.workingDays) >= 0.5
            ? ` (${bench.workingDays.toFixed(0)} en moy.)`
            : ""
        }`
      : null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Charge de travail</p>
        {verdict && (
          <button
            type="button"
            onClick={() => setAvisOpen((v) => !v)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              avisOpen
                ? verdict.good === true
                  ? "bg-emerald-100 border-emerald-200 text-emerald-900"
                  : verdict.good === false
                    ? "bg-amber-100 border-amber-200 text-amber-900"
                    : "bg-slate-200 border-slate-300 text-slate-800"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            Avis
          </button>
        )}
      </div>

      {avisOpen && verdict && (
        <div
          className={cn(
            "rounded-xl border px-5 py-4 mb-5 text-sm",
            verdict.good === true && "bg-emerald-50 border-emerald-100 text-emerald-900",
            verdict.good === false && "bg-amber-50 border-amber-100 text-amber-900",
            verdict.good == null && "bg-slate-50 border-slate-200 text-slate-800"
          )}
        >
          <p className="font-medium">{verdict.text}</p>
          {daysNote && <p className="mt-1 text-slate-600">{daysNote}</p>}
          <p className="mt-3 text-xs font-normal text-slate-500">
            Le volume décrit la charge (commandes). Le rythme (l/h) dit si l’équipe a bien travaillé — même un mois plus faible.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <CompareCard
          label="Lignes / jour"
          value={current.linesPerDay != null ? current.linesPerDay.toFixed(0) : "—"}
          numericCurrent={current.linesPerDay}
          help={HELP.linesPerDay}
          rollingLabel={rollingLabel}
          rollingDisplay={bench?.linesPerDay != null ? bench.linesPerDay.toFixed(0) : undefined}
          rollingNumeric={bench?.linesPerDay ?? null}
          momDisplay={previous?.linesPerDay != null ? previous.linesPerDay.toFixed(0) : undefined}
          momNumeric={previous?.linesPerDay ?? null}
        />
        <CompareCard
          label="Volume SAP (pick + emb.)"
          value={current.totalLines.toLocaleString("fr-CA")}
          numericCurrent={current.totalLines}
          help={HELP.volume}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? Math.round(bench.totalLines).toLocaleString("fr-CA") : undefined}
          rollingNumeric={bench?.totalLines ?? null}
          momDisplay={previous ? previous.totalLines.toLocaleString("fr-CA") : undefined}
          momNumeric={previous?.totalLines ?? null}
        />
        <CompareCard
          label="Lignes picking"
          value={current.pickLines.toLocaleString("fr-CA")}
          numericCurrent={current.pickLines}
          help={HELP.pickLines}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? Math.round(bench.pickLines).toLocaleString("fr-CA") : undefined}
          rollingNumeric={bench?.pickLines ?? null}
          momDisplay={previous ? previous.pickLines.toLocaleString("fr-CA") : undefined}
          momNumeric={previous?.pickLines ?? null}
        />
        <CompareCard
          label="Lignes emballage"
          value={current.packLines.toLocaleString("fr-CA")}
          numericCurrent={current.packLines}
          help={HELP.packLines}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? Math.round(bench.packLines).toLocaleString("fr-CA") : undefined}
          rollingNumeric={bench?.packLines ?? null}
          momDisplay={previous ? previous.packLines.toLocaleString("fr-CA") : undefined}
          momNumeric={previous?.packLines ?? null}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <CompareCard
          label="Vagues (pick)"
          value={current.pickWaves.toLocaleString("fr-CA")}
          numericCurrent={current.pickWaves}
          help={HELP.waves}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? Math.round(bench.pickWaves).toLocaleString("fr-CA") : undefined}
          rollingNumeric={bench?.pickWaves ?? null}
          momDisplay={previous ? previous.pickWaves.toLocaleString("fr-CA") : undefined}
          momNumeric={previous?.pickWaves ?? null}
        />
        <CompareCard
          label="Picklists (pick)"
          value={current.pickPicklists.toLocaleString("fr-CA")}
          numericCurrent={current.pickPicklists}
          help={HELP.picklists}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? Math.round(bench.pickPicklists).toLocaleString("fr-CA") : undefined}
          rollingNumeric={bench?.pickPicklists ?? null}
          momDisplay={previous ? previous.pickPicklists.toLocaleString("fr-CA") : undefined}
          momNumeric={previous?.pickPicklists ?? null}
        />
        <CompareCard
          label="Lignes moy. / vague"
          value={formatAvgLinesPerWave(current.linesPerWave)}
          valueSub={
            current.linesPerWaveExclSinglePl != null
              ? `${formatAvgLinesPerWave(current.linesPerWaveExclSinglePl)} hors 1 PL`
              : undefined
          }
          numericCurrent={current.linesPerWave}
          help={HELP.linesPerWave}
          rollingLabel={rollingLabel}
          rollingDisplay={
            bench
              ? formatDualWaveAvg(bench.linesPerWave, bench.linesPerWaveExclSinglePl)
              : undefined
          }
          rollingNumeric={bench?.linesPerWave ?? null}
          momDisplay={
            previous
              ? formatDualWaveAvg(previous.linesPerWave, previous.linesPerWaveExclSinglePl)
              : undefined
          }
          momNumeric={previous?.linesPerWave ?? null}
        />
        <CompareCard
          label="Picklists moy. / vague"
          value={formatAvgPicklistsPerWave(current.picklistsPerWave)}
          valueSub={
            current.picklistsPerWaveExclSinglePl != null
              ? `${formatAvgPicklistsPerWave(current.picklistsPerWaveExclSinglePl)} hors 1 PL`
              : undefined
          }
          numericCurrent={current.picklistsPerWave}
          help={HELP.picklistsPerWave}
          rollingLabel={rollingLabel}
          rollingDisplay={
            bench
              ? formatDualWaveAvg(
                  bench.picklistsPerWave,
                  bench.picklistsPerWaveExclSinglePl,
                  true
                )
              : undefined
          }
          rollingNumeric={bench?.picklistsPerWave ?? null}
          momDisplay={
            previous
              ? formatDualWaveAvg(
                  previous.picklistsPerWave,
                  previous.picklistsPerWaveExclSinglePl,
                  true
                )
              : undefined
          }
          momNumeric={previous?.picklistsPerWave ?? null}
        />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Performance d’équipe</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <CompareCard
          label="L/h picking équipe"
          value={formatRate(current.teamPickLinesPerHour)}
          numericCurrent={current.teamPickLinesPerHour}
          help={HELP.rate}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? formatRate(bench.teamPickLinesPerHour) : undefined}
          rollingNumeric={bench?.teamPickLinesPerHour ?? null}
          momDisplay={previous ? formatRate(previous.teamPickLinesPerHour) : undefined}
          momNumeric={previous?.teamPickLinesPerHour ?? null}
        />
        <CompareCard
          label="Heures vs charge"
          value={formatLoadPct(loadRatio)}
          numericCurrent={currentLoadPct}
          higherIsBetter={false}
          help={HELP.load}
          // Couleur vs 0 % (référence déjà intégrée au %) — sans ligne « Moy. 3 mois = 0 % »
          rollingNumeric={currentLoadPct != null ? 0 : null}
          rollingMode="points"
          momDisplay={previousLoadPct != null ? formatLoadPct(previousLoadRatio) : undefined}
          momNumeric={previousLoadPct}
          momCurrent={currentLoadPct}
          momMode="points"
        />
        <CompareCard
          label="Picking mal loggé"
          value={`${current.misloggedPct.toFixed(0)}%`}
          numericCurrent={current.misloggedPct}
          higherIsBetter={false}
          help={HELP.mislog}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? `${bench.misloggedPct.toFixed(0)}%` : undefined}
          rollingNumeric={bench?.misloggedPct ?? null}
          momDisplay={previous ? `${previous.misloggedPct.toFixed(0)}%` : undefined}
          momNumeric={previous?.misloggedPct ?? null}
        />
        <CompareCard
          label="Heures plancher"
          value={formatHours(current.floorHours)}
          numericCurrent={current.floorHours}
          higherIsBetter={false}
          tone="context"
          help={HELP.floor}
          rollingLabel={rollingLabel}
          rollingDisplay={bench ? formatHours(bench.floorHours) : undefined}
          rollingNumeric={bench?.floorHours ?? null}
          momDisplay={previous ? formatHours(previous.floorHours) : undefined}
          momNumeric={previous?.floorHours ?? null}
        />
      </div>
    </>
  );
}
