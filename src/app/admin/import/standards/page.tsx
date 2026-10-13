"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle2, AlertCircle, ArrowRight, RotateCcw, FileSpreadsheet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { readExcelFile } from "@/lib/xlsx";
import { cellToItemCode, findColumnIndex } from "@/lib/production";

type ParsedStandard = {
  itemCode: string;
  standardMinutes: number;
  valid: boolean;
  error?: string;
};

export default function ImportStandardsPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedStandard[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [result, setResult] = useState<{ success: number; errors: number; errorSample?: string } | null>(null);

  async function processFile(file: File) {
    setParsing(true);
    setResult(null);
    setFileName(file.name);

    const { headers, rows } = await readExcelFile(file);
    const itemCol = findColumnIndex(headers, ["articlesuperieur", "article", "item", "code"]);
    const timeCol = findColumnIndex(headers, ["tempsstandard", "standard", "temps"]);

    if (itemCol < 0 || timeCol < 0) {
      alert(`Colonnes introuvables. En-têtes trouvés: ${headers.join(", ")}`);
      setParsing(false);
      return;
    }

    const items: ParsedStandard[] = rows.map((row) => {
      const itemCode = cellToItemCode(row[itemCol]);
      const rawTime = row[timeCol];
      const standardMinutes = typeof rawTime === "number"
        ? rawTime
        : parseFloat(String(rawTime).replace(",", "."));

      if (!itemCode) return { itemCode: "", standardMinutes: 0, valid: false, error: "Code item vide" };
      if (isNaN(standardMinutes) || standardMinutes <= 0) {
        return { itemCode, standardMinutes: 0, valid: false, error: "Temps standard invalide" };
      }
      return { itemCode, standardMinutes, valid: true };
    });

    setParsed(items);
    setParsing(false);
  }

  async function handleImport() {
    const valid = parsed.filter((p) => p.valid);
    if (valid.length === 0) return;

    setImporting(true);
    setImportProgress(0);

    const today = new Date().toISOString().slice(0, 10);

    const { data: batch } = await supabase.from("import_batches").insert({
      import_type: "PRODUCTION_STANDARDS",
      source_system: "SAP",
      period_start: today,
      period_end: today,
      file_name: fileName,
      row_count: valid.length,
      status: "processing",
    }).select().single();

    const CHUNK = 200;
    let success = 0;
    let errors = 0;
    let errorSample: string | undefined;

    // Vider la table avant réimport complet (évite les doublons)
    const { error: deleteErr } = await supabase
      .from("production_standards")
      .delete()
      .gte("created_at", "1970-01-01");

    if (deleteErr) {
      setImporting(false);
      setResult({ success: 0, errors: valid.length, errorSample: `Suppression: ${deleteErr.message}` });
      return;
    }

    for (let i = 0; i < valid.length; i += CHUNK) {
      const chunk = valid.slice(i, i + CHUNK);
      const rows = chunk.map((item) => ({
        item_code: item.itemCode,
        standard_minutes_per_unit: item.standardMinutes,
        is_active: true,
        effective_date: today,
      }));

      const { error } = await supabase.from("production_standards").insert(rows);

      if (error) {
        if (!errorSample) errorSample = error.message;
        for (const row of rows) {
          const { error: rowErr } = await supabase.from("production_standards").insert(row);
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

      setImportProgress(Math.min(99, Math.round(((i + CHUNK) / valid.length) * 100)));
    }

    if (batch) {
      await supabase.from("import_batches").update({
        status: errors === 0 ? "completed" : "failed",
        row_count: success,
      }).eq("id", batch.id);
    }

    setImportProgress(100);
    setImporting(false);
    setResult({ success, errors, errorSample });
  }

  function reset() {
    setFileName(null);
    setParsed([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const validCount = parsed.filter((p) => p.valid).length;
  const invalidCount = parsed.length - validCount;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Import — Temps standards"
        subtitle="Fichier Excel : Article supérieur + TempsStandard (minutes décimales, ex: 3.5 = 3min30)"
      />

      {!parsed.length && !result && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center cursor-pointer hover:border-primary/40 hover:bg-slate-50 transition-colors"
        >
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
          {parsing ? (
            <p className="text-slate-500">Analyse…</p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <FileSpreadsheet className="w-10 h-10 text-green-500" />
              <p className="font-semibold text-slate-700">Glisser ou sélectionner le fichier Excel</p>
              <p className="text-xs text-slate-400">Liste de temps standard.xlsx</p>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className={cn("p-5 rounded-xl border-2 flex gap-3",
            result.errors === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200")}>
            <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
            <div>
              <p className="font-semibold">{result.success} standards importés</p>
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
          <Button variant="secondary" onClick={reset}><RotateCcw className="w-3.5 h-3.5" /> Autre fichier</Button>
        </div>
      )}

      {parsed.length > 0 && !result && !importing && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-white border rounded-xl">
            <FileSpreadsheet className="w-5 h-5 text-green-500" />
            <div className="flex-1">
              <p className="text-sm font-medium">{fileName}</p>
              <p className="text-xs text-slate-400">{parsed.length} lignes · {validCount} valides · {invalidCount} invalides</p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>×</Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 border border-green-100 rounded-xl p-4">
              <p className="text-2xl font-bold text-green-700">{validCount}</p>
              <p className="text-xs text-green-600">Standards valides</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-2xl font-bold text-red-600">{invalidCount}</p>
              <p className="text-xs text-red-500">Lignes invalides</p>
            </div>
          </div>

          {invalidCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-h-40 overflow-y-auto">
              <p className="text-xs font-semibold text-amber-800 mb-2">Lignes invalides (aperçu)</p>
              {parsed.filter((p) => !p.valid).slice(0, 10).map((p, i) => (
                <p key={i} className="text-xs text-amber-700">{p.itemCode || "—"} — {p.error}</p>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleImport} disabled={validCount === 0}>
              Importer {validCount} standards <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {importing && (
        <div className="bg-white border rounded-xl p-6 space-y-3">
          <p className="font-medium text-slate-700">Import en cours… {importProgress}%</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${importProgress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            Remplacement complet · lots de 200 — ne fermez pas cette page.
          </p>
        </div>
      )}
    </div>
  );
}
