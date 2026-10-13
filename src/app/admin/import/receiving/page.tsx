"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, CheckCircle2, AlertCircle, ArrowRight, RotateCcw,
  FileSpreadsheet, ChevronDown, ChevronUp, ShieldAlert,
} from "lucide-react";

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
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { readExcelFile } from "@/lib/xlsx";
import { readCsvFile } from "@/lib/inventory";
import {
  findReceivingColumns,
  parseSapDocDate,
  toPeriodMonth,
  buildExternalKey,
  matchEmployee,
  type EmployeeMapping,
} from "@/lib/receiving";

type ParsedLine = {
  externalKey: string;
  userName: string;
  employeeId: string | null;
  docDate: string;
  periodMonth: string;
  lineCount: number;
  valid: boolean;
  error?: string;
  isDuplicate: boolean;
};

type Analysis = {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  unmapped: number;
  months: string[];
  totalLines: number;
};

export default function ImportReceivingPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mappings, setMappings] = useState<EmployeeMapping[]>([]);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [refLoaded, setRefLoaded] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedLine[]>([]);
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
      const [mapsRes, existingRes] = await Promise.all([
        supabase
          .from("employee_system_mapping")
          .select("employee_id, external_employee_code, external_employee_name, employees(full_name)")
          .eq("system_name", "SAP")
          .eq("is_active", true),
        fetchAllRows<{ external_key: string }>((from, to) =>
          supabase
            .from("receiving_daily_counts")
            .select("external_key")
            .range(from, to)
        ),
      ]);
      setMappings((mapsRes.data as unknown as EmployeeMapping[]) ?? []);
      setExistingKeys(new Set(existingRes.data.map((r) => r.external_key)));
      setRefLoaded(true);
    }
    load();
  }, []);

  useEffect(() => {
    setMonthConflicts([]);
    setImportMode("complement");
    if (!analysis || analysis.months.length === 0) return;
    let cancelled = false;
    async function check() {
      const result: MonthConflict[] = [];
      for (const m of analysis!.months) {
        const { count } = await supabase
          .from("receiving_daily_counts")
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
      const cols = findReceivingColumns(headers);

      if (cols.dateCol < 0) {
        alert(`Colonne date manquante (DocDate). En-têtes: ${headers.join(" | ")}`);
        setParsing(false);
        return;
      }
      if (cols.userCol < 0) {
        alert(`Colonne employé manquante (U_NAME / Employé). En-têtes: ${headers.join(" | ")}`);
        setParsing(false);
        return;
      }
      if (cols.linesCol < 0) {
        alert(`Colonne lignes manquante (Lignes / COUNT). En-têtes: ${headers.join(" | ")}`);
        setParsing(false);
        return;
      }

      const items: ParsedLine[] = rows.map((row) => {
        const userName = String(row[cols.userCol] ?? "").trim();
        const docDate = parseSapDocDate(row[cols.dateCol]);
        const rawLines = row[cols.linesCol];
        const lineCount =
          typeof rawLines === "number"
            ? Math.round(rawLines)
            : parseInt(String(rawLines ?? "").trim(), 10);

        if (!userName) {
          return {
            externalKey: "",
            userName: "",
            employeeId: null,
            docDate: "",
            periodMonth: "",
            lineCount: 0,
            valid: false,
            error: "Employé vide",
            isDuplicate: false,
          };
        }
        if (!docDate) {
          return {
            externalKey: "",
            userName,
            employeeId: null,
            docDate: "",
            periodMonth: "",
            lineCount: 0,
            valid: false,
            error: "Date invalide",
            isDuplicate: false,
          };
        }
        if (!Number.isFinite(lineCount) || lineCount < 0) {
          return {
            externalKey: buildExternalKey(docDate, userName),
            userName,
            employeeId: null,
            docDate,
            periodMonth: toPeriodMonth(docDate),
            lineCount: 0,
            valid: false,
            error: "Nombre de lignes invalide",
            isDuplicate: existingKeys.has(buildExternalKey(docDate, userName)),
          };
        }

        const externalKey = buildExternalKey(docDate, userName);
        const employeeId = matchEmployee(null, userName, mappings);
        const isDuplicate = existingKeys.has(externalKey);

        return {
          externalKey,
          userName,
          employeeId,
          docDate,
          periodMonth: toPeriodMonth(docDate),
          lineCount,
          valid: true,
          isDuplicate,
        };
      });

      const validItems = items.filter((i) => i.valid && !i.isDuplicate);
      const months = [...new Set(validItems.map((i) => i.periodMonth))].sort();

      setParsed(items);
      setAnalysis({
        total: items.length,
        valid: validItems.length,
        invalid: items.filter((i) => !i.valid).length,
        duplicates: items.filter((i) => i.isDuplicate).length,
        unmapped: validItems.filter((i) => !i.employeeId).length,
        months,
        totalLines: validItems.reduce((s, i) => s + i.lineCount, 0),
      });
      setParsing(false);
    },
    [existingKeys, mappings]
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

    if (importMode === "replace" && monthConflicts.length > 0) {
      for (const { month } of monthConflicts) {
        await supabase.from("receiving_daily_counts").delete().eq("period_month", month);
      }
      const replacedMonths = new Set(monthConflicts.map((c) => c.month));
      setExistingKeys((prev) => {
        const next = new Set(prev);
        for (const p of parsed) {
          if (replacedMonths.has(p.periodMonth)) next.delete(p.externalKey);
        }
        return next;
      });
    }

    const toImport = importMode === "replace"
      ? parsed.filter((p) => p.valid && p.employeeId && (
          monthConflicts.some((c) => c.month === p.periodMonth) || !p.isDuplicate
        ))
      : parsed.filter((p) => p.valid && !p.isDuplicate && p.employeeId);

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
        import_type: "SAP_RECEIVING",
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
        external_user_name: p.userName,
        doc_date: p.docDate,
        period_month: p.periodMonth,
        line_count: p.lineCount,
      }));

      const { error } = await supabase.from("receiving_daily_counts").insert(rows);
      if (error) {
        if (!errorSample) errorSample = error.message;
        for (const row of rows) {
          const { error: rowErr } = await supabase
            .from("receiving_daily_counts")
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
        title="Import — Réception SAP"
        subtitle="Export Matthieu : DocDate, Employé (U_NAME), Lignes — OPDN entrepôts 01/03 + transferts ASN 02→01/03"
      />

      {refLoaded && (
        <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
          <span className="font-semibold">{existingKeys.size.toLocaleString("fr-CA")} jours-employés</span> déjà en base
          · {mappings.length} mappings SAP actifs
          <p className="text-xs text-slate-400 mt-1">
            Requête SQL : <code className="font-mono">supabase/sap_receiving_export.sql</code> (avril–juin 2026)
          </p>
        </div>
      )}

      {!analysis && !result && !importing && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center cursor-pointer hover:border-orange-300 hover:bg-slate-50"
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
            <p className="text-slate-500">Analyse…</p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-10 h-10 text-orange-500" />
              <p className="font-semibold text-slate-700">Sélectionner l&apos;export SAP réception</p>
              <p className="text-xs text-slate-400">CSV ou Excel · 1 ligne = 1 employé × 1 jour</p>
            </div>
          )}
        </div>
      )}

      {importing && (
        <div className="bg-white border rounded-xl p-6 space-y-3">
          <p className="font-medium">Import en cours… {progress}%</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-orange-500 h-2 rounded-full transition-all"
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
              result.errors === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
            )}
          >
            <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
            <div>
              <p className="font-semibold">{result.success} jours-employés importés</p>
              {result.skipped > 0 && (
                <p className="text-sm text-slate-600">{result.skipped} doublons ignorés</p>
              )}
              {result.errors > 0 && (
                <>
                  <p className="text-sm text-red-600">{result.errors} erreurs</p>
                  {result.errorSample && (
                    <p className="text-xs text-red-500 mt-1 font-mono">{result.errorSample}</p>
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

      {analysis && !importing && !result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-white border rounded-xl">
            <FileSpreadsheet className="w-5 h-5 text-orange-500" />
            <div className="flex-1">
              <p className="text-sm font-medium">{fileName}</p>
              <p className="text-xs text-slate-400">
                {analysis.total} lignes · {analysis.totalLines.toLocaleString("fr-CA")} lignes réceptionnées
                · Mois : {analysis.months.join(", ")}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>×</Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Nouvelles entrées" value={analysis.valid} color="green" />
            <StatCard label="Doublons (ignorés)" value={analysis.duplicates} color="slate" />
            <StatCard label="Non mappés" value={analysis.unmapped} color="amber" />
            <StatCard label="Total lignes" value={analysis.totalLines} color="slate" />
          </div>

          {analysis.unmapped > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                {analysis.unmapped} entrées sans employé TCAP — mappez les noms SAP (U_NAME) dans{" "}
                <strong>Mapping employés</strong>.
              </p>
            </div>
          )}

          {analysis.invalid > 0 && (
            <div className="bg-white border rounded-xl p-4">
              <button
                className="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
                onClick={() => setShowDetails((v) => !v)}
              >
                <span>Lignes invalides ({analysis.invalid})</span>
                {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showDetails && (
                <div className="mt-3 space-y-1 max-h-32 overflow-y-auto text-xs text-red-600">
                  {parsed
                    .filter((p) => !p.valid)
                    .slice(0, 15)
                    .map((p, i) => (
                      <p key={i}>
                        {p.userName || "—"} — {p.error}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}

          {monthConflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">Données déjà importées pour ces mois</p>
                <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                  {monthConflicts.map((c) => (
                    <li key={c.month}>{fmtMonth(c.month)} — {c.count.toLocaleString("fr-CA")} entrées existantes</li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setImportMode("complement")}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      importMode === "complement"
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")}
                  >
                    Compléter — ajouter seulement les nouvelles entrées
                  </button>
                  <button
                    onClick={() => setImportMode("replace")}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      importMode === "replace"
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-red-700 border-red-300 hover:bg-red-50")}
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
            <Button onClick={handleImport} disabled={analysis.valid === 0}>
              {importMode === "replace" ? "Remplacer et importer" : "Importer"}{" "}
              {analysis.valid} entrées <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
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
      <p className="text-2xl font-bold text-slate-800">{value.toLocaleString("fr-CA")}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
