"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Shield,
  Database,
  Cloud,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { MonthCompare, SapDataSource } from "@/lib/sap/types";

const DATASET_LABEL: Record<string, string> = {
  picking: "Picking",
  packaging: "Emballage",
  receiving: "Réception",
  inventory: "Inventaire",
};

const MONTH_FR: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_FR[m ?? ""] ?? m} ${y}`;
}

export default function SapControlPage() {
  const [months, setMonths] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<MonthCompare | null>(null);
  const [source, setSource] = useState<SapDataSource>("supabase");
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allResults, setAllResults] = useState<MonthCompare[]>([]);
  const [runningAll, setRunningAll] = useState(false);

  const loadSource = useCallback(async () => {
    const res = await fetch("/api/sap/source");
    const json = await res.json();
    if (json.source) setSource(json.source);
  }, []);

  const loadMonths = useCallback(async () => {
    setLoadingMonths(true);
    setError(null);
    try {
      const res = await fetch("/api/sap/compare");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur");
      setMonths(json.months ?? []);
      setSelected((cur) => cur || json.months?.[0] || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement mois");
    } finally {
      setLoadingMonths(false);
    }
  }, []);

  useEffect(() => {
    loadMonths();
    loadSource();
  }, [loadMonths, loadSource]);

  async function compareOne(month: string) {
    setComparing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/sap/compare?month=${month}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur comparaison");
      setResult(json);
      return json as MonthCompare;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      return null;
    } finally {
      setComparing(false);
    }
  }

  async function compareAll() {
    setRunningAll(true);
    setError(null);
    setAllResults([]);
    const out: MonthCompare[] = [];
    for (const m of months) {
      try {
        const res = await fetch(`/api/sap/compare?month=${m}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || m);
        out.push(json);
        setAllResults([...out]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
        break;
      }
    }
    setRunningAll(false);
  }

  async function switchSource(next: SapDataSource) {
    if (next === "wrapper") {
      const ok =
        (result?.allMatch || allResults.every((r) => r.allMatch)) &&
        (result != null || allResults.length > 0);
      if (!ok) {
        const confirm = window.confirm(
          "Le contrôle n'est pas vert (ou pas encore lancé). Basculer quand même vers le wrapper ?"
        );
        if (!confirm) return;
      }
    }
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/sap/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur");
      setSource(json.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSwitching(false);
    }
  }

  const allGreen =
    allResults.length > 0 &&
    allResults.length === months.length &&
    allResults.every((r) => r.allMatch);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Contrôle SAP"
        subtitle="Compare le wrapper aux mois déjà importés dans Supabase. Aucune écriture."
      />

      {/* Source actuelle */}
      <div
        className={cn(
          "rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3",
          source === "wrapper"
            ? "border-amber-300 bg-amber-50"
            : "border-zinc-200 bg-white"
        )}
      >
        <div className="flex items-center gap-3">
          {source === "wrapper" ? (
            <Cloud className="w-5 h-5 text-amber-600" />
          ) : (
            <Database className="w-5 h-5 text-zinc-600" />
          )}
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              Source KPI : {source === "wrapper" ? "Wrapper SAP" : "Supabase"}
            </p>
            <p className="text-xs text-zinc-500">
              {source === "wrapper"
                ? "Les pages KPI lisent SAP en direct. Tu peux revenir à Supabase tout de suite."
                : "Les pages KPI lisent les tables importées. Rien ne change tant que tu ne bascules pas."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {source === "wrapper" ? (
            <Button
              onClick={() => switchSource("supabase")}
              disabled={switching}
              className="bg-zinc-900 hover:bg-zinc-800"
            >
              <Shield className="w-4 h-4 mr-1.5" />
              Lecture Supabase
            </Button>
          ) : (
            <Button
              onClick={() => switchSource("wrapper")}
              disabled={switching}
              variant="secondary"
            >
              Basculer vers Wrapper
              {!allGreen && result && !result.allMatch && (
                <AlertTriangle className="w-3.5 h-3.5 ml-1.5 text-amber-500" />
              )}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm space-y-1">
          <span className="text-zinc-500 text-xs font-medium uppercase tracking-wide">
            Mois importé
          </span>
          <select
            className="block border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loadingMonths || months.length === 0}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() => selected && compareOne(selected)}
          disabled={!selected || comparing || runningAll}
        >
          <RefreshCw className={cn("w-4 h-4 mr-1.5", comparing && "animate-spin")} />
          Comparer ce mois
        </Button>
        <Button
          variant="secondary"
          onClick={compareAll}
          disabled={months.length === 0 || comparing || runningAll}
        >
          <RefreshCw className={cn("w-4 h-4 mr-1.5", runningAll && "animate-spin")} />
          Comparer tous ({months.length})
        </Button>
      </div>

      {/* Résumé tous les mois */}
      {allResults.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <p className="text-sm font-semibold">Tous les mois</p>
            {allGreen ? (
              <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Tout vert
              </span>
            ) : (
              <span className="text-xs font-medium text-red-600 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> Écarts détectés
              </span>
            )}
          </div>
          <ul className="divide-y divide-zinc-100">
            {allResults.map((r) => (
              <li
                key={r.month}
                className="px-4 py-2.5 flex items-center justify-between text-sm cursor-pointer hover:bg-zinc-50"
                onClick={() => {
                  setSelected(r.month);
                  setResult(r);
                }}
              >
                <span>{fmtMonth(r.month)}</span>
                {r.allMatch ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Détail d'un mois */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{fmtMonth(result.month)}</h2>
            {result.allMatch ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                Identique
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium">
                Écart
              </span>
            )}
          </div>

          {result.datasets.map((d) => (
            <div
              key={d.dataset}
              className={cn(
                "rounded-xl border p-4",
                d.totalsMatch && d.detailMatch
                  ? "border-emerald-200 bg-emerald-50/40"
                  : "border-red-200 bg-red-50/30"
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-sm">
                  {DATASET_LABEL[d.dataset] ?? d.dataset}
                </p>
                {d.totalsMatch && d.detailMatch ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500 mb-1 font-medium">Supabase</p>
                  <p>Lignes : {d.supabase.lineCount}</p>
                  <p>Jours : {d.supabase.dayRows}</p>
                  {d.dataset === "picking" && (
                    <>
                      <p>Vagues : {d.supabase.waveCount}</p>
                      <p>Picklists : {d.supabase.picklistCount}</p>
                    </>
                  )}
                  {d.dataset === "inventory" && (
                    <p>Écarts : {d.supabase.discrepancyCount ?? 0}</p>
                  )}
                </div>
                <div>
                  <p className="text-zinc-500 mb-1 font-medium">Wrapper</p>
                  <p>Lignes : {d.wrapper.lineCount}</p>
                  <p>Jours : {d.wrapper.dayRows}</p>
                  {d.dataset === "picking" && (
                    <>
                      <p>Vagues : {d.wrapper.waveCount}</p>
                      <p>Picklists : {d.wrapper.picklistCount}</p>
                    </>
                  )}
                  {d.dataset === "inventory" && (
                    <p>Écarts : {d.wrapper.discrepancyCount ?? 0}</p>
                  )}
                </div>
              </div>
              {!d.detailMatch && d.detailDiffs.length > 0 && (
                <div className="mt-3 pt-3 border-t border-red-100">
                  <p className="text-xs font-medium text-red-700 mb-1">
                    Détail (max 25)
                  </p>
                  <ul className="text-[11px] text-red-800/80 space-y-0.5 max-h-40 overflow-y-auto font-mono">
                    {d.detailDiffs.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loadingMonths && months.length === 0 && (
        <p className="text-sm text-zinc-500">
          Aucun mois importé trouvé dans Supabase.
        </p>
      )}
    </div>
  );
}
