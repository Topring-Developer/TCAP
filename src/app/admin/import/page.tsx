"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, CheckCircle2, AlertCircle, XCircle,
  FileText, Users, ListChecks, Clock, ArrowRight,
  RotateCcw, ShieldAlert,
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
function dateToMonth(d: string) { return d.slice(0, 7); }
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type EmpMapping = { employee_id: string; external_employee_name: string | null };
type TaskMap    = { id: string; s8_task_name: string; include_in_kpi: boolean; kpi_department: string | null };

type ParsedRow = {
  fullName: string;
  taskName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  employeeId: string | null;
  taskMappingId: string | null;
  skipReason: "pause" | "zero_duration" | null;
};

type Analysis = {
  totalRows: number;
  dateStart: string;
  dateEnd: string;
  skippedPause: number;
  skippedZero: number;
  ready: number;
  unmappedEmployees: string[];
  unmappedTasks: string[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function decodeHtml(str: string): string {
  if (typeof document === "undefined") return str;
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

function timeToMinutes(t: string): number {
  const p = t.split(":");
  return parseInt(p[0] ?? "0") * 60 + parseInt(p[1] ?? "0") + parseInt(p[2] ?? "0") / 60;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ImportS8Page() {
  const supabase = createClient();

  const [empMappings, setEmpMappings]   = useState<EmpMapping[]>([]);
  const [taskMappings, setTaskMappings] = useState<TaskMap[]>([]);
  const [refLoaded, setRefLoaded]       = useState(false);

  const [isDragging, setIsDragging]     = useState(false);
  const [fileName, setFileName]         = useState<string | null>(null);
  const [parsedRows, setParsedRows]     = useState<ParsedRow[]>([]);
  const [analysis, setAnalysis]         = useState<Analysis | null>(null);
  const [parsing, setParsing]           = useState(false);

  const [importing, setImporting]       = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<{ success: number; errors: number; batchId: string } | null>(null);
  const [monthConflicts, setMonthConflicts] = useState<MonthConflict[]>([]);
  const [importMode, setImportMode] = useState<"complement" | "replace">("complement");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Charger les mappings de référence depuis Supabase
  useEffect(() => {
    async function loadRef() {
      const [{ data: emps }, { data: tasks }] = await Promise.all([
        supabase
          .from("employee_system_mapping")
          .select("employee_id, external_employee_name")
          .eq("system_name", "S8")
          .eq("is_active", true),
        supabase
          .from("task_mapping")
          .select("id, s8_task_name, include_in_kpi, kpi_department"),
      ]);
      setEmpMappings(emps ?? []);
      setTaskMappings(tasks ?? []);
      setRefLoaded(true);
    }
    loadRef();
  }, []);

  // Vérifier les mois déjà présents dans s8_time_logs après analyse
  useEffect(() => {
    setMonthConflicts([]);
    setImportMode("complement");
    if (!analysis || !analysis.dateStart || !analysis.dateEnd) return;
    let cancelled = false;
    async function check() {
      // Dériver les mois couverts par la plage de dates
      const months: string[] = [];
      const start = new Date(analysis!.dateStart + "T00:00:00");
      const end   = new Date(analysis!.dateEnd   + "T00:00:00");
      const cur   = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
        cur.setMonth(cur.getMonth() + 1);
      }
      const result: MonthConflict[] = [];
      for (const m of months) {
        const mStart = m + "-01";
        const mEnd   = m + "-31";
        const { count } = await supabase
          .from("s8_time_logs")
          .select("*", { count: "exact", head: true })
          .gte("log_date", mStart)
          .lte("log_date", mEnd);
        if (!cancelled && (count ?? 0) > 0)
          result.push({ month: m, count: count! });
      }
      if (!cancelled) setMonthConflicts(result);
    }
    check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  // ─── Parsing ──────────────────────────────────────────────────────────────

  const parseCSV = useCallback((text: string) => {
    setParsing(true);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const rows: ParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 7) continue;

      const firstName  = decodeHtml(cols[1] ?? "");
      const lastName   = decodeHtml(cols[2] ?? "");
      const fullName   = lastName ? `${firstName} ${lastName}`.trim() : firstName.trim();
      const taskName   = decodeHtml(cols[3] ?? "");
      const date       = cols[4] ?? "";
      const startTime  = cols[5] ?? "";
      const endTime    = cols[6] ?? "";
      const duration   = timeToMinutes(endTime) - timeToMinutes(startTime);

      let skipReason: ParsedRow["skipReason"] = null;
      if (taskName.toLowerCase() === "pause") skipReason = "pause";
      else if (duration <= 0) skipReason = "zero_duration";

      const empMap  = empMappings.find(
        (m) => (m.external_employee_name ?? "").toLowerCase() === fullName.toLowerCase()
      );
      const taskMap = taskMappings.find(
        (t) => (t.s8_task_name ?? "").toLowerCase() === taskName.toLowerCase()
      );

      rows.push({
        fullName,
        taskName,
        date,
        startTime,
        endTime,
        durationMinutes: Math.max(0, duration),
        employeeId: empMap?.employee_id ?? null,
        taskMappingId: taskMap?.id ?? null,
        skipReason,
      });
    }

    setParsedRows(rows);

    const active = rows.filter((r) => !r.skipReason);
    const dates  = active.map((r) => r.date).filter(Boolean).sort();

    const unmappedEmpSet  = new Set(active.filter((r) => !r.employeeId).map((r) => r.fullName));
    const unmappedTaskSet = new Set(active.filter((r) => !r.taskMappingId).map((r) => r.taskName));

    setAnalysis({
      totalRows:          rows.length,
      dateStart:          dates[0] ?? "",
      dateEnd:            dates[dates.length - 1] ?? "",
      skippedPause:       rows.filter((r) => r.skipReason === "pause").length,
      skippedZero:        rows.filter((r) => r.skipReason === "zero_duration").length,
      ready:              active.length,
      unmappedEmployees:  [...unmappedEmpSet].sort(),
      unmappedTasks:      [...unmappedTaskSet].sort(),
    });
    setParsing(false);
  }, [empMappings, taskMappings]);

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Fichier CSV requis (.csv)");
      return;
    }
    setFileName(file.name);
    setAnalysis(null);
    setParsedRows([]);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (e) => parseCSV(e.target?.result as string);
    reader.readAsText(file, "utf-8");
  }

  // ─── Drag & drop ──────────────────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave()                  { setIsDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!parsedRows.length || !analysis) return;
    setImporting(true);
    setImportProgress(0);

    // En mode "replace" : supprimer les logs S8 des mois en conflit
    if (importMode === "replace" && monthConflicts.length > 0) {
      for (const { month } of monthConflicts) {
        const mStart = month + "-01";
        const mEnd   = month + "-31";
        await supabase.from("s8_time_logs").delete()
          .gte("log_date", mStart)
          .lte("log_date", mEnd);
      }
    }

    const active = parsedRows.filter((r) => !r.skipReason);

    // Créer le batch d'import
    const { data: batch, error: batchErr } = await supabase
      .from("import_batches")
      .insert({
        import_type: "S8_TIME_LOGS",
        source_system: "S8",
        period_start: analysis.dateStart,
        period_end: analysis.dateEnd,
        file_name: fileName,
        row_count: active.length,
        status: "processing",
      })
      .select()
      .single();

    if (batchErr || !batch) {
      alert("Erreur lors de la création du batch d'import : " + batchErr?.message);
      setImporting(false);
      return;
    }

    // Insérer par tranches de 100, avec fallback ligne par ligne si erreur
    const CHUNK = 100;
    let success = 0;
    let errors  = 0;

    function buildRow(r: ParsedRow) {
      return {
        import_batch_id:        batch.id,
        employee_id:            r.employeeId,
        external_employee_name: r.fullName,
        task_name:              r.taskName,
        task_mapping_id:        r.taskMappingId,
        log_date:               r.date,
        start_time:             r.startTime || null,
        end_time:               r.endTime   || null,
        duration_minutes:       r.durationMinutes,
        validation_status:      r.employeeId && r.taskMappingId ? "validated" : "pending",
      };
    }

    for (let i = 0; i < active.length; i += CHUNK) {
      const chunk = active.slice(i, i + CHUNK);
      const rows  = chunk.map(buildRow);

      const { error } = await supabase.from("s8_time_logs").insert(rows);

      if (error) {
        // Le bloc a échoué — réessayer ligne par ligne pour récupérer le maximum
        for (const row of chunk) {
          const { error: rowErr } = await supabase.from("s8_time_logs").insert(buildRow(row));
          if (rowErr) errors++;
          else        success++;
        }
      } else {
        success += rows.length;
      }

      setImportProgress(Math.min(99, Math.round(((i + CHUNK) / active.length) * 100)));
    }

    // Mettre à jour le statut du batch
    await supabase
      .from("import_batches")
      .update({ status: errors === 0 ? "completed" : "failed", row_count: success })
      .eq("id", batch.id);

    setImportProgress(100);
    setImporting(false);
    setImportResult({ success, errors, batchId: batch.id });
  }

  function reset() {
    setFileName(null);
    setParsedRows([]);
    setAnalysis(null);
    setImportResult(null);
    setImportProgress(0);
    setMonthConflicts([]);
    setImportMode("complement");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const noMappings = refLoaded && empMappings.length === 0;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Import — Logs S8"
        subtitle="Importer un fichier CSV d'activités exporté depuis TWMS/S8"
      />

      {/* Avertissement si aucun mapping employé */}
      {noMappings && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Aucun mapping employé S8 configuré</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Les logs seront importés mais aucun employé ne sera reconnu.
              Configure les mappings dans <strong>Administration → Mapping employés</strong> avant d&apos;importer.
            </p>
          </div>
        </div>
      )}

      {/* Zone d'upload */}
      {!analysis && !importing && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors",
            isDragging
              ? "border-primary/50 bg-primary/5"
              : "border-slate-200 hover:border-primary/40 hover:bg-slate-50"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
          />
          {parsing ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium text-slate-600">Analyse en cours…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 bg-primary/5 rounded-full flex items-center justify-center">
                <Upload className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-slate-700">Glisser le fichier CSV ici</p>
                <p className="text-sm text-slate-400 mt-1">ou cliquer pour sélectionner</p>
              </div>
              <p className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                Format : activités_AAAA-MM-JJ_to_AAAA-MM-JJ.csv
              </p>
            </div>
          )}
        </div>
      )}

      {/* Résultat d'import */}
      {importResult && (
        <div className="space-y-4">
          <div className={cn(
            "p-5 rounded-xl border-2 flex items-start gap-4",
            importResult.errors === 0
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          )}>
            {importResult.errors === 0
              ? <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
              : <AlertCircle  className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />}
            <div>
              <p className="font-semibold text-slate-800">
                {importResult.errors === 0 ? "Import terminé avec succès" : "Import terminé avec des erreurs"}
              </p>
              <p className="text-sm text-slate-600 mt-1">
                <strong>{importResult.success}</strong> lignes importées
                {importResult.errors > 0 && <> · <strong className="text-red-600">{importResult.errors}</strong> erreurs</>}
              </p>
              <p className="text-xs text-slate-400 mt-1">Batch ID : {importResult.batchId}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="w-3.5 h-3.5" /> Importer un autre fichier
          </Button>
        </div>
      )}

      {/* Progression import */}
      {importing && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-4 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="font-medium text-slate-700">Import en cours… {importProgress}%</p>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Analyse */}
      {analysis && !importing && !importResult && (
        <div className="space-y-4">
          {/* Fichier sélectionné */}
          <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl">
            <FileText className="w-5 h-5 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{fileName}</p>
              <p className="text-xs text-slate-400">
                {analysis.dateStart} → {analysis.dateEnd} · {analysis.totalRows.toLocaleString()} lignes brutes
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
              <XCircle className="w-4 h-4" />
            </Button>
          </div>

          {/* Cartes résumé */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={Clock}
              label="Lignes à importer"
              value={analysis.ready}
              color="blue"
            />
            <StatCard
              icon={XCircle}
              label="Pauses ignorées"
              value={analysis.skippedPause}
              color="slate"
            />
            <StatCard
              icon={AlertCircle}
              label="Durée nulle ignorées"
              value={analysis.skippedZero}
              color="slate"
            />
          </div>

          {/* Employés mappés */}
          <MappingBlock
            icon={Users}
            title="Employés reconnus"
            total={analysis.ready}
            mapped={analysis.ready - parsedRows.filter(r => !r.skipReason && !r.employeeId).length}
            unmapped={analysis.unmappedEmployees}
            unmappedLabel="Noms non trouvés dans le mapping S8"
            tip="Administration → Mapping employés"
          />

          {/* Tâches mappées */}
          <MappingBlock
            icon={ListChecks}
            title="Tâches reconnues"
            total={analysis.ready}
            mapped={analysis.ready - parsedRows.filter(r => !r.skipReason && !r.taskMappingId).length}
            unmapped={analysis.unmappedTasks}
            unmappedLabel="Tâches absentes du mapping"
            tip="Administration → Mapping tâches"
          />

          {/* Avertissement double-import S8 */}
          {monthConflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">Logs S8 déjà importés pour ces mois</p>
                <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                  {monthConflicts.map((c) => (
                    <li key={c.month}>{fmtMonth(c.month)} — {c.count.toLocaleString("fr-CA")} lignes existantes</li>
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
                    Compléter — ajouter seulement les nouvelles lignes
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
                    ⚠ Les {monthConflicts.reduce((s, c) => s + c.count, 0).toLocaleString("fr-CA")} lignes existantes seront supprimées avant l&apos;import.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Bouton import */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-slate-400">
              Les lignes non mappées seront importées avec le statut <em>En attente</em>.
            </p>
            <Button onClick={handleImport} disabled={analysis.ready === 0}>
              {importMode === "replace" ? "Remplacer et importer" : "Importer"}{" "}
              {analysis.ready.toLocaleString()} lignes <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: "blue" | "slate" | "green" | "amber";
}) {
  const colors = {
    blue:  "bg-blue-50  border-blue-100  text-blue-600",
    slate: "bg-slate-50 border-slate-200 text-slate-500",
    green: "bg-green-50 border-green-100 text-green-600",
    amber: "bg-amber-50 border-amber-100 text-amber-600",
  };
  return (
    <div className={cn("rounded-xl border p-4", colors[color])}>
      <Icon className="w-4 h-4 mb-2 opacity-70" />
      <p className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</p>
      <p className="text-xs mt-0.5">{label}</p>
    </div>
  );
}

function MappingBlock({
  icon: Icon,
  title,
  total,
  mapped,
  unmapped,
  unmappedLabel,
  tip,
}: {
  icon: React.ElementType;
  title: string;
  total: number;
  mapped: number;
  unmapped: string[];
  unmappedLabel: string;
  tip: string;
}) {
  const [open, setOpen] = useState(false);
  const pct = total > 0 ? Math.round((mapped / total) * 100) : 100;
  const ok  = unmapped.length === 0;

  return (
    <div className={cn("bg-white rounded-xl border p-4", ok ? "border-slate-200" : "border-amber-200")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {ok
            ? <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 className="w-3.5 h-3.5" />Tout mappé</span>
            : <span className="text-xs text-amber-600 font-medium">{mapped} / {total} ({pct}%)</span>
          }
        </div>
      </div>

      {/* Barre de progression */}
      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
        <div
          className={cn("h-1.5 rounded-full", ok ? "bg-green-500" : "bg-amber-400")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Liste non mappés */}
      {!ok && (
        <div>
          <button
            className="text-xs text-amber-700 font-medium flex items-center gap-1 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▲" : "▼"} {unmapped.length} {unmappedLabel}
          </button>
          {open && (
            <div className="mt-2 space-y-1">
              {unmapped.map((name) => (
                <div key={name} className="text-xs text-slate-600 bg-amber-50 px-2 py-1 rounded flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                  {name}
                </div>
              ))}
              <p className="text-xs text-slate-400 mt-1">→ Corriger dans : {tip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
