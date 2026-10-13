"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, CheckCircle2, AlertCircle, ArrowRight, RotateCcw,
  FileSpreadsheet, ChevronDown, ChevronUp, ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { readExcelFile } from "@/lib/xlsx";
import { readCsvFile } from "@/lib/inventory";
import {
  findPickingColumns,
  parseSapDocDate,
  toPeriodMonth,
  buildPickingExternalKey,
  buildWaveExternalKey,
  matchEmployee,
  type EmployeeMapping,
} from "@/lib/picking";

type MonthConflict = { month: string; count: number };

const MONTH_FR: Record<string, string> = {
  "01":"Jan","02":"Fév","03":"Mar","04":"Avr",
  "05":"Mai","06":"Jun","07":"Jul","08":"Aoû",
  "09":"Sep","10":"Oct","11":"Nov","12":"Déc",
};
function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_FR[m ?? ""] ?? m} ${y}`;
}

type ParsedDay = {
  externalKey: string;
  userCode: string | null;
  userName: string;
  employeeId: string | null;
  docDate: string;
  periodMonth: string;
  lineCount: number;
  waveCount: number;
  picklistCount: number;
  valid: boolean;
  error?: string;
  isDuplicate: boolean;
  skipReason?: "unmapped" | "inactive";
};

function filterPickingToImport(
  parsed: ParsedDay[],
  importMode: "complement" | "replace",
  monthConflicts: MonthConflict[]
): ParsedDay[] {
  if (importMode === "replace") {
    return parsed.filter(
      (p) =>
        p.valid &&
        (monthConflicts.some((c) => c.month === p.periodMonth) || !p.isDuplicate)
    );
  }
  return parsed.filter((p) => p.valid && !p.isDuplicate);
}

type ParsedWave = {
  externalKey: string;
  waveKey: string;
  periodMonth: string;
  docDate: string;
  lineCount: number;
  picklistCount: number;
};

type Analysis = {
  totalRawRows: number;
  days: number;
  valid: number;
  invalid: number;
  duplicates: number;
  unmapped: number;
  inactive: number;
  months: string[];
  totalLines: number;
  unmappedNames: string[];
};

export default function ImportPickingPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mappings, setMappings] = useState<EmployeeMapping[]>([]);
  const [activeEmployeeIds, setActiveEmployeeIds] = useState<Set<string>>(new Set());
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [refLoaded, setRefLoaded] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedDay[]>([]);
  const [parsedWaves, setParsedWaves] = useState<ParsedWave[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    success: number;
    skipped: number;
    errors: number;
    errorSample?: string;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [monthConflicts, setMonthConflicts] = useState<MonthConflict[]>([]);
  const [importMode, setImportMode] = useState<"complement" | "replace">("complement");

  useEffect(() => {
    async function load() {
      const [mapsRes, empsRes, existingRes] = await Promise.all([
        supabase
          .from("employee_system_mapping")
          .select("employee_id, external_employee_code, external_employee_name, employees(full_name)")
          .eq("system_name", "SAP")
          .eq("is_active", true),
        supabase.from("employees").select("id, is_active"),
        fetchAllRows<{ external_key: string }>((from, to) =>
          supabase
            .from("picking_daily_counts")
            .select("external_key")
            .range(from, to)
        ),
      ]);
      setMappings((mapsRes.data as unknown as EmployeeMapping[]) ?? []);
      setActiveEmployeeIds(
        new Set((empsRes.data ?? []).filter((e) => e.is_active).map((e) => e.id))
      );
      setExistingKeys(new Set(existingRes.data.map((r) => r.external_key)));
      setRefLoaded(true);
    }
    load();
  }, []);

  // Vérifier si les mois du fichier ont déjà des données en base
  useEffect(() => {
    setMonthConflicts([]);
    setImportMode("complement");
    if (!analysis || analysis.months.length === 0) return;
    let cancelled = false;
    async function check() {
      const result: MonthConflict[] = [];
      for (const m of analysis!.months) {
        const { count } = await supabase
          .from("picking_daily_counts")
          .select("*", { count: "exact", head: true })
          .eq("period_month", m);
        if (!cancelled && (count ?? 0) > 0)
          result.push({ month: m, count: count! });
      }
      if (!cancelled) setMonthConflicts(result);
    }
    check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  const processRows = useCallback(
    (headers: string[], rows: unknown[][]) => {
      const cols = findPickingColumns(headers);

      if (cols.dateCol < 0) {
        alert(`Colonne date manquante (CreateDate). En-têtes: ${headers.join(" | ")}`);
        setParsing(false);
        return;
      }
      if (cols.nameCol < 0 && cols.codeCol < 0) {
        alert(
          `Colonne employé manquante (Code utilisateur / Nom). En-têtes: ${headers.join(" | ")}`
        );
        setParsing(false);
        return;
      }

      // Agrégation employé × jour
      type Agg = {
        userCode: string | null;
        userName: string;
        docDate: string;
        waves: Set<string>;
        picklists: Set<string>;
        lineCount: number;
      };
      const aggMap = new Map<string, Agg>();
      type WaveAgg = {
        waveKey: string;
        periodMonth: string;
        docDate: string;
        lineCount: number;
        picklists: Set<string>;
      };
      const waveMap = new Map<string, WaveAgg>();

      for (const row of rows) {
        const userCode =
          cols.codeCol >= 0 ? String(row[cols.codeCol] ?? "").trim() || null : null;
        const userName =
          cols.nameCol >= 0 ? String(row[cols.nameCol] ?? "").trim() : "";
        const docDate = parseSapDocDate(row[cols.dateCol]);
        if (!docDate) continue;
        if (!userCode && !userName) continue;

        const key = buildPickingExternalKey(docDate, userCode, userName);
        const wave =
          cols.waveCol >= 0 ? String(row[cols.waveCol] ?? "").trim() : "";
        const picklist =
          cols.picklistCol >= 0 ? String(row[cols.picklistCol] ?? "").trim() : "";

        if (wave) {
          const periodMonth = toPeriodMonth(docDate);
          const waveKey = buildWaveExternalKey(periodMonth, wave);
          const wExisting = waveMap.get(waveKey);
          if (wExisting) {
            wExisting.lineCount += 1;
            if (picklist) wExisting.picklists.add(picklist);
            if (docDate < wExisting.docDate) wExisting.docDate = docDate;
          } else {
            waveMap.set(waveKey, {
              waveKey: wave,
              periodMonth,
              docDate,
              lineCount: 1,
              picklists: new Set(picklist ? [picklist] : []),
            });
          }
        }

        const existing = aggMap.get(key);
        if (existing) {
          existing.lineCount += 1;
          if (wave) existing.waves.add(wave);
          if (picklist) existing.picklists.add(picklist);
          if (!existing.userName && userName) existing.userName = userName;
          if (!existing.userCode && userCode) existing.userCode = userCode;
        } else {
          aggMap.set(key, {
            userCode,
            userName: userName || userCode || "?",
            docDate,
            waves: new Set(wave ? [wave] : []),
            picklists: new Set(picklist ? [picklist] : []),
            lineCount: 1,
          });
        }
      }

      const items: ParsedDay[] = [...aggMap.entries()].map(([externalKey, a]) => {
        const matchedId = matchEmployee(a.userCode, a.userName, mappings);
        // On garde employee_id même si inactif ; null seulement si non mappé
        const employeeId = matchedId;
        let skipReason: "unmapped" | "inactive" | undefined;
        let error: string | undefined;

        if (!matchedId) {
          skipReason = "unmapped";
          error = "Employé non mappé / non créé — importé quand même";
        } else if (!activeEmployeeIds.has(matchedId)) {
          skipReason = "inactive";
          error = "Employé inactif — importé quand même";
        }

        const isDuplicate = existingKeys.has(externalKey);

        return {
          externalKey,
          userCode: a.userCode,
          userName: a.userName,
          employeeId,
          docDate: a.docDate,
          periodMonth: toPeriodMonth(a.docDate),
          lineCount: a.lineCount,
          waveCount: a.waves.size,
          picklistCount: a.picklists.size,
          valid: true,
          error,
          isDuplicate,
          skipReason,
        };
      });

      const waves: ParsedWave[] = [...waveMap.entries()].map(([externalKey, w]) => ({
        externalKey,
        waveKey: w.waveKey,
        periodMonth: w.periodMonth,
        docDate: w.docDate,
        lineCount: w.lineCount,
        picklistCount: w.picklists.size,
      }));

      // Tout est importable sauf les doublons (non mappés / inactifs inclus)
      const importable = items.filter((i) => i.valid && !i.isDuplicate);
      const unmappedItems = items.filter((i) => i.skipReason === "unmapped");
      const inactiveItems = items.filter((i) => i.skipReason === "inactive");
      const months = [...new Set(items.map((i) => i.periodMonth))].sort();
      const unmappedNames = [
        ...new Set(
          [...unmappedItems, ...inactiveItems].map((i) =>
            i.userCode ? `${i.userName} (${i.userCode})` : i.userName
          )
        ),
      ].sort();

      setParsed(items);
      setParsedWaves(waves);
      setAnalysis({
        totalRawRows: rows.length,
        days: items.length,
        valid: importable.length,
        invalid: 0,
        duplicates: items.filter((i) => i.isDuplicate).length,
        unmapped: unmappedItems.length,
        inactive: inactiveItems.length,
        months,
        totalLines: importable.reduce((s, i) => s + i.lineCount, 0),
        unmappedNames,
      });
      setParsing(false);
    },
    [existingKeys, mappings, activeEmployeeIds]
  );

  async function parseFile(file: File) {
    setParsing(true);
    setResult(null);
    setFileName(file.name);

    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const { headers, rows } = isCsv
      ? await readCsvFile(file)
      : await readExcelFile(file);

    processRows(headers, rows);
  }

  async function handleImport() {
    if (!analysis) return;

    setImporting(true);
    setProgress(0);

    // En mode "replace" : supprimer d'abord les données des mois en conflit
    if (importMode === "replace" && monthConflicts.length > 0) {
      for (const { month } of monthConflicts) {
        await supabase.from("picking_daily_counts").delete().eq("period_month", month);
        await supabase.from("picking_wave_stats").delete().eq("period_month", month);
      }
      // Retirer ces clés de existingKeys pour ne pas bloquer la réinsertion
      const replacedMonths = new Set(monthConflicts.map((c) => c.month));
      setExistingKeys((prev) => {
        const next = new Set(prev);
        for (const p of parsed) {
          if (replacedMonths.has(p.periodMonth)) next.delete(p.externalKey);
        }
        return next;
      });
    }

    const toImport = filterPickingToImport(parsed, importMode, monthConflicts);

    if (toImport.length === 0) {
      setImporting(false);
      setResult({ success: 0, skipped: parsed.filter((p) => p.isDuplicate).length, errors: 0 });
      return;
    }

    const months = analysis.months;
    const periodStart = months[0] ? `${months[0]}-01` : new Date().toISOString().slice(0, 10);
    const periodEnd = months[months.length - 1]
      ? `${months[months.length - 1]}-28`
      : periodStart;

    const { data: batch, error: batchErr } = await supabase
      .from("import_batches")
      .insert({
        import_type: "SAP_PICKING",
        source_system: "SAP",
        period_start: periodStart,
        period_end: periodEnd,
        file_name: fileName,
        row_count: toImport.length,
        status: "processing",
      })
      .select()
      .single();

    if (batchErr || !batch) {
      setResult({
        success: 0,
        skipped: 0,
        errors: toImport.length,
        errorSample: batchErr?.message,
      });
      setImporting(false);
      return;
    }

    const CHUNK = 200;
    let success = 0;
    let errors = 0;
    let errorSample: string | undefined;

    for (let i = 0; i < toImport.length; i += CHUNK) {
      const chunk = toImport.slice(i, i + CHUNK);
      const rows = chunk.map((p) => ({
        external_key: p.externalKey,
        import_batch_id: batch.id,
        employee_id: p.employeeId,
        external_user_code: p.userCode,
        external_user_name: p.userName,
        doc_date: p.docDate,
        period_month: p.periodMonth,
        line_count: p.lineCount,
        wave_count: p.waveCount,
        picklist_count: p.picklistCount,
      }));

      const { error } = await supabase.from("picking_daily_counts").insert(rows);
      if (error) {
        if (!errorSample) errorSample = error.message;
        for (const row of rows) {
          const { error: rowErr } = await supabase
            .from("picking_daily_counts")
            .insert(row);
          if (rowErr) {
            errors++;
            if (!errorSample) errorSample = rowErr.message;
          } else {
            success++;
          }
        }
      } else {
        success += rows.length;
      }
      setProgress(Math.min(99, Math.round(((i + CHUNK) / toImport.length) * 100)));
    }

    // Stats par vague (WaveKey)
    const importMonths = [...new Set(toImport.map((p) => p.periodMonth))];
    const fileWaves = parsedWaves.filter((w) => importMonths.includes(w.periodMonth));

    for (const month of importMonths) {
      const monthFileWaves = fileWaves.filter((w) => w.periodMonth === month);
      let merged = monthFileWaves;

      if (importMode === "complement") {
        const { data: existing } = await fetchAllRows<{
          wave_key: string;
          period_month: string;
          doc_date: string;
          line_count: number;
          picklist_count: number;
          external_key: string;
        }>((from, to) =>
          supabase.from("picking_wave_stats").select("external_key, wave_key, period_month, doc_date, line_count, picklist_count")
            .eq("period_month", month).range(from, to)
        );
        const map = new Map<string, ParsedWave>();
        for (const e of existing) {
          map.set(e.external_key, {
            externalKey: e.external_key,
            waveKey: e.wave_key,
            periodMonth: e.period_month,
            docDate: e.doc_date,
            lineCount: e.line_count,
            picklistCount: e.picklist_count,
          });
        }
        for (const w of monthFileWaves) {
          const cur = map.get(w.externalKey);
          if (cur) {
            cur.lineCount += w.lineCount;
            cur.picklistCount += w.picklistCount;
          } else {
            map.set(w.externalKey, { ...w });
          }
        }
        merged = [...map.values()];
      }

      await supabase.from("picking_wave_stats").delete().eq("period_month", month);

      for (let i = 0; i < merged.length; i += CHUNK) {
        const chunk = merged.slice(i, i + CHUNK);
        const waveRows = chunk.map((w) => ({
          external_key: w.externalKey,
          import_batch_id: batch.id,
          wave_key: w.waveKey,
          period_month: w.periodMonth,
          doc_date: w.docDate,
          line_count: w.lineCount,
          picklist_count: w.picklistCount,
        }));
        await supabase.from("picking_wave_stats").insert(waveRows);
      }
    }

    await supabase
      .from("import_batches")
      .update({
        status: errors === 0 ? "completed" : "failed",
        row_count: success,
      })
      .eq("id", batch.id);

    setProgress(100);
    setImporting(false);
    setResult({
      success,
      skipped: analysis.duplicates,
      errors,
      errorSample,
    });
  }

  function reset() {
    setFileName(null);
    setParsed([]);
    setParsedWaves([]);
    setAnalysis(null);
    setResult(null);
    setProgress(0);
    setMonthConflicts([]);
    setImportMode("complement");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Import — Picking SAP"
        subtitle="Export SAP : Code utilisateur, Nom, WaveKey, PickListNumb, CreateDate — 1 row = 1 ligne pickée"
      />

      {refLoaded && (
        <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
          <span className="font-semibold">
            {existingKeys.size.toLocaleString("fr-CA")} jours-employés
          </span>{" "}
          déjà en base · {mappings.length} mappings SAP actifs
        </div>
      )}

      {!analysis && !result && !importing && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center cursor-pointer hover:border-primary/40 hover:bg-slate-50"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseFile(f);
            }}
          />
          {parsing ? (
            <p className="text-slate-500">Analyse et agrégation…</p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-10 h-10 text-primary" />
              <p className="font-semibold text-slate-700">
                Sélectionner l&apos;export SAP picking
              </p>
              <p className="text-xs text-slate-400">
                CSV ou Excel · agrégé automatiquement par employé × jour
              </p>
            </div>
          )}
        </div>
      )}

      {importing && (
        <div className="bg-white border rounded-xl p-6 space-y-3">
          <p className="font-medium">Import en cours… {progress}%</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div
            className={cn(
              "p-5 rounded-xl border-2 flex gap-3",
              result.errors === 0
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
            )}
          >
            <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
            <div>
              <p className="font-semibold">
                {result.success} jours-employés importés
              </p>
              {result.skipped > 0 && (
                <p className="text-sm text-slate-600">
                  {result.skipped} ignorés (doublons / non mappés / inactifs)
                </p>
              )}
              {result.errors > 0 && (
                <>
                  <p className="text-sm text-red-600">{result.errors} erreurs</p>
                  {result.errorSample && (
                    <p className="text-xs text-red-500 mt-1 font-mono">
                      {result.errorSample}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="w-3.5 h-3.5" /> Autre fichier
          </Button>
        </div>
      )}

      {analysis && !importing && !result && (() => {
        const pending = filterPickingToImport(parsed, importMode, monthConflicts);
        const pendingCount = pending.length;
        const pendingLines = pending.reduce((s, p) => s + p.lineCount, 0);
        return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-white border rounded-xl">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">{fileName}</p>
              <p className="text-xs text-slate-400">
                {analysis.totalRawRows.toLocaleString("fr-CA")} lignes brutes →{" "}
                {analysis.days} jours-employés · Mois : {analysis.months.join(", ")}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>
              ×
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="À importer" value={pendingCount} color="green" />
            <StatCard label="Doublons" value={analysis.duplicates} color="slate" />
            <StatCard label="Non mappés (inclus)" value={analysis.unmapped} color="amber" />
            <StatCard label="Inactifs (inclus)" value={analysis.inactive} color="amber" />
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
            <strong>{analysis.totalRawRows.toLocaleString("fr-CA")}</strong> lignes brutes Excel
            → <strong>{pendingLines.toLocaleString("fr-CA")}</strong> lignes pickées
            agrégées en <strong>{pendingCount}</strong> jours-employés
            (1 enregistrement = 1 personne × 1 jour).
          </div>

          {(analysis.unmapped > 0 || analysis.inactive > 0) && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p>
                  {analysis.unmapped > 0 && (
                    <>
                      {analysis.unmapped} jours-employés non mappés / non créés
                      {analysis.inactive > 0 ? " · " : ""}
                    </>
                  )}
                  {analysis.inactive > 0 && (
                    <>{analysis.inactive} jours-employés inactifs</>
                  )}
                  {" — "}inclus dans l&apos;import pour la productivité entrepôt complète.
                  Mappez les codes SAP dans <strong>Mapping employés</strong> pour
                  lier les heures S8.
                </p>
                {analysis.unmappedNames.length > 0 && (
                  <button
                    className="mt-2 flex items-center gap-1 text-xs font-semibold"
                    onClick={() => setShowDetails((v) => !v)}
                  >
                    Voir les noms ({analysis.unmappedNames.length})
                    {showDetails ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                )}
                {showDetails && (
                  <ul className="mt-2 max-h-40 overflow-y-auto text-xs space-y-0.5">
                    {analysis.unmappedNames.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {monthConflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">Données déjà importées pour ces mois</p>
                <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                  {monthConflicts.map((c) => (
                    <li key={c.month}>
                      {fmtMonth(c.month)} — {c.count.toLocaleString("fr-CA")} entrées existantes
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setImportMode("complement")}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      importMode === "complement"
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    Compléter — ajouter seulement les nouvelles entrées
                  </button>
                  <button
                    onClick={() => setImportMode("replace")}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      importMode === "replace"
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-red-700 border-red-300 hover:bg-red-50"
                    )}
                  >
                    Remplacer — supprimer et réimporter ces mois
                  </button>
                </div>
                {importMode === "replace" && (
                  <p className="mt-2 text-xs text-red-600 font-medium">
                    ⚠ Les {monthConflicts.reduce((s, c) => s + c.count, 0).toLocaleString("fr-CA")} entrées existantes seront supprimées avant l&apos;import.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleImport} disabled={pendingCount === 0}>
              {importMode === "replace" ? "Remplacer et importer" : "Importer"}{" "}
              {pendingCount}{" "}
              entrées <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "amber" | "slate";
}) {
  const colors = {
    green: "bg-green-50 border-green-100",
    amber: "bg-amber-50 border-amber-100",
    slate: "bg-slate-50 border-slate-200",
  };
  return (
    <div className={cn("rounded-xl border p-4", colors[color])}>
      <p className="text-2xl font-bold text-slate-800">
        {value.toLocaleString("fr-CA")}
      </p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
