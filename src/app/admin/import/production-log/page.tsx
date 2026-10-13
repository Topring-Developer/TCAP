"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, CheckCircle2, AlertCircle, XCircle,
  ArrowRight, RotateCcw, ShieldAlert, Users, Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type MonthConflict = { month: string; count: number };

const MONTH_FR: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};
function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_FR[m ?? ""] ?? m} ${y}`;
}

type ParsedRow = {
  idSap: string;
  itemcode: string;
  bom: string | null;
  numCommande: string | null;
  quantity: number;
  timestampBegin: string | null;   // ISO string
  timestampEnd: string | null;     // ISO string
  durationMinutes: number | null;
  periodMonth: string;             // YYYY-MM
};

const MIN_MONTH = "2026-04"; // Les lignes avant ce mois sont exclues de l'import

type Analysis = {
  total: number;
  skipped: number;
  excludedBeforeMinMonth: number;
  ready: number;
  months: string[];
  uniqueEmployees: string[];
  uniqueItems: number;
  parseErrors: number;
};

// ─── Helpers CSV ────────────────────────────────────────────────────────────

/** Détecte le séparateur du CSV (virgule ou point-virgule) */
function detectSeparator(header: string): string {
  const commas = (header.match(/,/g) ?? []).length;
  const semis = (header.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

/** Parse une ligne CSV en tenant compte des guillemets */
function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** Normalise un en-tête de colonne pour matching flexible */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

/** Trouve l'index d'une colonne par mots-clés possibles */
function findCol(headers: string[], keywords: string[]): number {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex((h) => keywords.some((k) => h.includes(k)));
}

/**
 * Parse une valeur timestamp en ISO string.
 * Accepte : "2026-04-01 06:59:00", "2026-04-01T07:03:00", etc.
 */
function parseTimestamp(value: string): string | null {
  if (!value || value.trim() === "") return null;
  const str = value.trim().replace(" ", "T");
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

/** Extrait YYYY-MM d'un ISO string */
function toMonth(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 7);
}

// ─── Composant principal ────────────────────────────────────────────────────

export default function ImportProductionLogPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging]   = useState(false);
  const [fileName, setFileName]       = useState<string | null>(null);
  const [parsed, setParsed]           = useState<ParsedRow[]>([]);
  const [analysis, setAnalysis]       = useState<Analysis | null>(null);
  const [parsing, setParsing]         = useState(false);
  const [importing, setImporting]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [result, setResult]           = useState<{ success: number; errors: number } | null>(null);
  const [monthConflicts, setMonthConflicts] = useState<MonthConflict[]>([]);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  // ─── Vérification conflits de mois ──────────────────────────────────────

  useEffect(() => {
    setMonthConflicts([]);
    setReplaceConfirmed(false);
    if (!analysis || analysis.months.length === 0) return;
    let cancelled = false;

    async function check() {
      const conflicts: MonthConflict[] = [];
      for (const m of analysis!.months) {
        const { count } = await supabase
          .from("production_log_lines")
          .select("*", { count: "exact", head: true })
          .eq("period_month", m);
        if (!cancelled && (count ?? 0) > 0)
          conflicts.push({ month: m, count: count! });
      }
      if (!cancelled) setMonthConflicts(conflicts);
    }

    check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  // ─── Parsing CSV ──────────────────────────────────────────────────────────

  const parseCSV = useCallback((text: string) => {
    setParsing(true);

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      alert("Fichier vide ou sans données.");
      setParsing(false);
      return;
    }

    const headerLine = lines[0]!;
    const sep = detectSeparator(headerLine);
    const headers = parseCsvLine(headerLine, sep);

    // Trouver les colonnes
    const colIdSap       = findCol(headers, ["id_sap", "idsap", "sap", "employeid", "employe"]);
    const colItemcode    = findCol(headers, ["itemcode", "item_code", "item", "article"]);
    const colBom         = findCol(headers, ["bom"]);
    const colNumCmd      = findCol(headers, ["num_commande", "commande", "numcommande", "order"]);
    const colQty         = findCol(headers, ["quantity", "quantite", "qty", "qte"]);
    const colBegin       = findCol(headers, ["timestamp_begin", "begin", "debut", "start", "timestampbegin"]);
    const colEnd         = findCol(headers, ["timestamp_end", "end", "fin", "timestampend"]);

    const missing: string[] = [];
    if (colIdSap < 0)    missing.push("id_sap");
    if (colItemcode < 0) missing.push("itemcode");
    if (colQty < 0)      missing.push("quantity");
    if (colBegin < 0)    missing.push("timestamp_begin");
    if (colEnd < 0)      missing.push("timestamp_end");

    if (missing.length > 0) {
      alert(`Colonnes manquantes : ${missing.join(", ")}\n\nEn-têtes détectés : ${headers.join(" | ")}`);
      setParsing(false);
      return;
    }

    const rows: ParsedRow[] = [];
    let parseErrors = 0;
    let excludedBeforeMinMonth = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]!, sep);
      if (cols.length < 3) continue;

      const idSap    = (cols[colIdSap] ?? "").trim();
      const itemcode = (cols[colItemcode] ?? "").trim();
      if (!idSap || !itemcode) { parseErrors++; continue; }

      const qtyRaw   = (cols[colQty] ?? "").trim().replace(",", ".");
      const qty      = parseFloat(qtyRaw);
      const tsBegin  = parseTimestamp(cols[colBegin] ?? "");
      const tsEnd    = parseTimestamp(cols[colEnd] ?? "");

      // Durée en minutes depuis les timestamps
      let durationMinutes: number | null = null;
      if (tsBegin && tsEnd) {
        const diffMs = new Date(tsEnd).getTime() - new Date(tsBegin).getTime();
        if (diffMs > 0) durationMinutes = diffMs / 60000;
      }

      const periodMonth = toMonth(tsBegin) ?? toMonth(tsEnd) ?? new Date().toISOString().slice(0, 7);

      // Exclure les lignes antérieures à avril 2026
      if (periodMonth < MIN_MONTH) { excludedBeforeMinMonth++; continue; }

      rows.push({
        idSap,
        itemcode,
        bom:            colBom >= 0 ? ((cols[colBom] ?? "").trim() || null) : null,
        numCommande:    colNumCmd >= 0 ? ((cols[colNumCmd] ?? "").trim() || null) : null,
        quantity:       isNaN(qty) ? 0 : qty,
        timestampBegin: tsBegin,
        timestampEnd:   tsEnd,
        durationMinutes,
        periodMonth,
      });
    }

    setParsed(rows);

    const months = [...new Set(rows.map((r) => r.periodMonth))].sort();
    const uniqueEmployees = [...new Set(rows.map((r) => r.idSap))].sort();
    const uniqueItems = new Set(rows.map((r) => r.itemcode)).size;

    setAnalysis({
      total: lines.length - 1,
      skipped: parseErrors,
      excludedBeforeMinMonth,
      ready: rows.length,
      months,
      uniqueEmployees,
      uniqueItems,
      parseErrors,
    });

    setParsing(false);
  }, []);

  // ─── Gestion fichier ─────────────────────────────────────────────────────

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Fichier CSV requis (.csv)");
      return;
    }
    setFileName(file.name);
    setAnalysis(null);
    setParsed([]);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => parseCSV(e.target?.result as string);
    reader.readAsText(file, "utf-8");
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave() { setIsDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!parsed.length || !analysis) return;
    if (monthConflicts.length > 0 && !replaceConfirmed) return;

    setImporting(true);
    setProgress(0);

    // Supprimer les mois en conflit si remplacement confirmé
    if (monthConflicts.length > 0 && replaceConfirmed) {
      for (const { month } of monthConflicts) {
        await supabase
          .from("production_log_lines")
          .delete()
          .eq("period_month", month);
      }
    }

    // Créer le batch d'import
    const months = analysis.months;
    const { data: batch, error: batchErr } = await supabase
      .from("import_batches")
      .insert({
        import_type: "TWMS_PRODUCTION_EMPLOYEE",
        source_system: "TWMS",
        period_start: months[0] ? `${months[0]}-01` : new Date().toISOString().slice(0, 10),
        period_end:   months[months.length - 1] ? `${months[months.length - 1]}-28` : new Date().toISOString().slice(0, 10),
        file_name:    fileName,
        row_count:    parsed.length,
        status:       "processing",
      })
      .select()
      .single();

    if (batchErr || !batch) {
      alert("Erreur batch : " + batchErr?.message);
      setImporting(false);
      return;
    }

    // Import en chunks de 500 (volume élevé)
    const CHUNK = 500;
    let success = 0;
    let errors  = 0;

    for (let i = 0; i < parsed.length; i += CHUNK) {
      const chunk = parsed.slice(i, i + CHUNK);
      const rows = chunk.map((p) => ({
        import_batch_id:  batch.id,
        id_sap:           p.idSap,
        itemcode:         p.itemcode,
        bom:              p.bom,
        num_commande:     p.numCommande,
        quantity:         p.quantity,
        timestamp_begin:  p.timestampBegin,
        timestamp_end:    p.timestampEnd,
        duration_minutes: p.durationMinutes,
        period_month:     p.periodMonth,
      }));

      const { error } = await supabase.from("production_log_lines").insert(rows);
      if (error) {
        // Fallback ligne par ligne
        for (const row of rows) {
          const { error: rowErr } = await supabase.from("production_log_lines").insert(row);
          if (rowErr) errors++;
          else success++;
        }
      } else {
        success += rows.length;
      }

      setProgress(Math.min(99, Math.round(((i + CHUNK) / parsed.length) * 100)));
    }

    await supabase
      .from("import_batches")
      .update({ status: errors === 0 ? "completed" : "failed", row_count: success })
      .eq("id", batch.id);

    setProgress(100);
    setImporting(false);
    setResult({ success, errors });
  }

  function reset() {
    setFileName(null);
    setParsed([]);
    setAnalysis(null);
    setResult(null);
    setProgress(0);
    setMonthConflicts([]);
    setReplaceConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Rendu ───────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Import — Prod employé (TWMS)"
        subtitle="CSV ligne par ligne : id_sap, itemcode, bom, num_commande, quantity, timestamp_begin, timestamp_end"
      />

      {/* Zone d'upload */}
      {!analysis && !importing && !result && (
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
              <p className="text-sm font-medium text-slate-600">Analyse du CSV en cours…</p>
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
              <p className="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full font-mono">
                id_sap · itemcode · bom · num_commande · quantity · timestamp_begin · timestamp_end
              </p>
            </div>
          )}
        </div>
      )}

      {/* Barre de progression */}
      {importing && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-4 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="font-medium text-slate-700">Import en cours… {progress}%</p>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            {Math.round((progress / 100) * (parsed.length))} / {parsed.length.toLocaleString("fr-CA")} lignes
          </p>
        </div>
      )}

      {/* Résultat */}
      {result && (
        <div className="space-y-4">
          <div className={cn(
            "p-5 rounded-xl border-2 flex items-start gap-4",
            result.errors === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
          )}>
            {result.errors === 0
              ? <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
              : <AlertCircle  className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />}
            <div>
              <p className="font-semibold text-slate-800">
                {result.errors === 0 ? "Import terminé avec succès" : "Import terminé avec des erreurs"}
              </p>
              <p className="text-sm text-slate-600 mt-1">
                <strong>{result.success.toLocaleString("fr-CA")}</strong> lignes importées
                {result.errors > 0 && <> · <strong className="text-red-600">{result.errors}</strong> erreurs</>}
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="w-3.5 h-3.5" /> Importer un autre fichier
          </Button>
        </div>
      )}

      {/* Analyse */}
      {analysis && !importing && !result && (
        <div className="space-y-4">
          {/* En-tête fichier */}
          <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl">
            <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Upload className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{fileName}</p>
              <p className="text-xs text-slate-400">
                {analysis.total.toLocaleString("fr-CA")} lignes brutes ·{" "}
                Mois : {analysis.months.map(fmtMonth).join(", ")}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} className="flex-shrink-0">
              <XCircle className="w-4 h-4 text-slate-400" />
            </Button>
          </div>

          {/* Cartes stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Lignes valides" value={analysis.ready} color="green" />
            <StatCard label="Items uniques" value={analysis.uniqueItems} color="blue" />
            <StatCard label="Employés" value={analysis.uniqueEmployees.length} color="purple" />
            <StatCard label="Lignes ignorées" value={analysis.skipped} color="slate" />
          </div>

          {/* Avertissement lignes exclues avant avril 2026 */}
          {analysis.excludedBeforeMinMonth > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <span className="text-amber-500 text-lg leading-none flex-shrink-0">⚠</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {analysis.excludedBeforeMinMonth.toLocaleString("fr-CA")} lignes exclues — antérieures à avril 2026
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Ces lignes ne seront <strong>pas importées</strong> dans Supabase.
                  Seules les données à partir de {MIN_MONTH} sont conservées.
                </p>
              </div>
            </div>
          )}

          {/* Mois détectés */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-slate-400" />
              <p className="text-sm font-semibold text-slate-700">Mois détectés</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {analysis.months.map((m) => (
                <span key={m} className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-full font-medium">
                  {fmtMonth(m)}
                </span>
              ))}
            </div>
          </div>

          {/* Employés */}
          {analysis.uniqueEmployees.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-slate-400" />
                <p className="text-sm font-semibold text-slate-700">
                  Employés TWMS ({analysis.uniqueEmployees.length})
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {analysis.uniqueEmployees.map((id) => (
                  <span key={id} className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-full font-mono">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Conflits de mois */}
          {monthConflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">
                  Données déjà importées — remplacement obligatoire
                </p>
                <p className="text-xs text-red-700 mt-1">
                  Ces mois contiennent déjà des données. L&apos;import sans suppression préalable créerait des doublons.
                </p>
                <ul className="mt-2 text-xs text-red-700 space-y-0.5">
                  {monthConflicts.map((c) => (
                    <li key={c.month}>
                      {fmtMonth(c.month)} — {c.count.toLocaleString("fr-CA")} lignes existantes
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replaceConfirmed}
                    onChange={(e) => setReplaceConfirmed(e.target.checked)}
                    className="rounded border-red-300"
                  />
                  <span className="text-xs text-red-800 font-medium">
                    Je confirme supprimer les{" "}
                    {monthConflicts.reduce((s, c) => s + c.count, 0).toLocaleString("fr-CA")}{" "}
                    lignes existantes et les remplacer
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Bouton import */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleImport}
              disabled={
                analysis.ready === 0 ||
                (monthConflicts.length > 0 && !replaceConfirmed)
              }
            >
              {monthConflicts.length > 0 ? "Remplacer et importer" : "Importer"}{" "}
              {analysis.ready.toLocaleString("fr-CA")} lignes <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "blue" | "purple" | "slate";
}) {
  const colors = {
    green:  "bg-green-50  border-green-100  text-green-700",
    blue:   "bg-blue-50   border-blue-100   text-blue-700",
    purple: "bg-purple-50 border-purple-100 text-purple-700",
    slate:  "bg-slate-50  border-slate-200  text-slate-600",
  };
  return (
    <div className={cn("rounded-xl border p-4", colors[color])}>
      <p className="text-2xl font-bold text-slate-800">{value.toLocaleString("fr-CA")}</p>
      <p className="text-xs mt-0.5">{label}</p>
    </div>
  );
}
