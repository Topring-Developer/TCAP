"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, CheckCircle2, AlertCircle, ArrowRight, RotateCcw,
  FileSpreadsheet, ChevronDown, ChevronUp, ShieldAlert, Copy, Check, Download,
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
import { readExcelWithFormattedItems } from "@/lib/xlsx";
import {
  cellToItemCode,
  findColumnIndex,
  matchItemCode,
  extractSeries,
  parseTimeToMinutes,
  evaluateExclusion,
  toPeriodMonth,
  toDatetime,
  formatMinutes,
  EXCLUSION_LABELS,
  type ExclusionReason,
} from "@/lib/production";

type Standard = { item_code: string; standard_minutes_per_unit: number };

type ParsedProduction = {
  bom: string | null;
  itemCode: string;
  itemMatched: string | null;
  series: string;
  quantity: number;
  actualMinutes: number;
  standardMinutesPerUnit: number | null;
  targetMinutes: number | null;
  actualMinutesPerUnit: number | null;
  ratio: number | null;
  periodMonth: string | null;
  lastUpdatedAt: string | null;
  includedInKpi: boolean;
  exclusionReason: ExclusionReason;
};

type Analysis = {
  total: number;
  included: number;
  excluded: number;
  months: string[];
  byReason: Record<string, number>;
  unmatchedItems: { code: string; lines: number; quantity: number }[];
};

export default function ImportProductionPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [standards, setStandards] = useState<Standard[]>([]);
  const [standardsError, setStandardsError] = useState<string | null>(null);
  const [refLoaded, setRefLoaded] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedProduction[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [copiedUnmatched, setCopiedUnmatched] = useState(false);
  const [manualMonth, setManualMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [needsManualMonth, setNeedsManualMonth] = useState(false);
  const [monthConflicts, setMonthConflicts] = useState<MonthConflict[]>([]);
  // Pour la production (pas de clé unique), on force le choix : replace obligatoire si conflit
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  useEffect(() => {
    async function load() {
      const { data, error } = await fetchAllRows<Standard>((from, to) =>
        supabase
          .from("production_standards")
          .select("item_code, standard_minutes_per_unit")
          .eq("is_active", true)
          .order("item_code")
          .range(from, to)
      );
      setStandards(data);
      setStandardsError(error);
      setRefLoaded(true);
    }
    load();
  }, []);

  const parseFile = useCallback(async (file: File) => {
    setParsing(true);
    setResult(null);
    setFileName(file.name);

    const { headers, rows } = await readExcelWithFormattedItems(file);

    const bomCol = findColumnIndex(headers, ["bom"]);
    const itemCol = findColumnIndex(headers, ["item", "article"]);
    const qtyCol = findColumnIndex(headers, ["quantite", "qty", "quantity"]);
    const timeCol = findColumnIndex(headers, ["tempsdeproduction", "temps", "production"]);
    const dateCol = findColumnIndex(headers, ["dernieremiseajour", "date", "miseajour"]);
    const hasDateCol = dateCol >= 0;

    if (itemCol < 0 || qtyCol < 0 || timeCol < 0) {
      alert(`Colonnes manquantes. En-têtes: ${headers.join(" | ")}`);
      setParsing(false);
      return;
    }

    const stdCodes = standards.map((s) => s.item_code);
    const stdMap = new Map(standards.map((s) => [s.item_code, s.standard_minutes_per_unit]));

    const items: ParsedProduction[] = rows.map((row) => {
      const itemCode = cellToItemCode(row[itemCol]);
      const itemMatched = matchItemCode(itemCode, stdCodes);
      const standardMinutesPerUnit = itemMatched ? (stdMap.get(itemMatched) ?? null) : null;

      const qty = typeof row[qtyCol] === "number"
        ? row[qtyCol] as number
        : parseFloat(String(row[qtyCol]).replace(",", "."));

      const timeRaw = row[timeCol];
      const actualMinutes = parseTimeToMinutes(timeRaw);

      const periodMonth = hasDateCol
        ? toPeriodMonth(row[dateCol])
        : manualMonth;
      const lastUpdatedAt = hasDateCol ? toDatetime(row[dateCol]) : null;

      const { includedInKpi, exclusionReason, ratio } = evaluateExclusion(
        qty, actualMinutes, standardMinutesPerUnit
      );

      const actualMinutesPerUnit = qty > 0 ? actualMinutes / qty : null;
      const targetMinutes = itemMatched && standardMinutesPerUnit != null
        ? qty * standardMinutesPerUnit
        : null;

      return {
        bom: bomCol >= 0 ? String(row[bomCol] ?? "").trim() || null : null,
        itemCode,
        itemMatched,
        series: extractSeries(itemMatched ?? itemCode),
        quantity: isNaN(qty) ? 0 : qty,
        actualMinutes,
        standardMinutesPerUnit,
        targetMinutes,
        actualMinutesPerUnit,
        ratio,
        periodMonth,
        lastUpdatedAt,
        includedInKpi,
        exclusionReason,
      };
    });

    setParsed(items);

    const byReason: Record<string, number> = {};
    for (const p of items.filter((i) => !i.includedInKpi)) {
      byReason[p.exclusionReason] = (byReason[p.exclusionReason] ?? 0) + 1;
    }

    const unmatchedMap = new Map<string, { lines: number; quantity: number }>();
    for (const i of items.filter((x) => !x.itemMatched)) {
      const prev = unmatchedMap.get(i.itemCode) ?? { lines: 0, quantity: 0 };
      unmatchedMap.set(i.itemCode, {
        lines: prev.lines + 1,
        quantity: prev.quantity + i.quantity,
      });
    }
    const unmatchedItems = [...unmatchedMap.entries()]
      .map(([code, v]) => ({ code, lines: v.lines, quantity: v.quantity }))
      .sort((a, b) => b.lines - a.lines || a.code.localeCompare(b.code));

    setNeedsManualMonth(!hasDateCol);

    setAnalysis({
      total: items.length,
      included: items.filter((i) => i.includedInKpi).length,
      excluded: items.filter((i) => !i.includedInKpi).length,
      months: [...new Set(items.map((i) => i.periodMonth).filter(Boolean) as string[])].sort(),
      byReason,
      unmatchedItems,
    });
    setParsing(false);
  }, [standards, manualMonth]);

  useEffect(() => {
    setMonthConflicts([]);
    setReplaceConfirmed(false);
    if (!analysis || analysis.months.length === 0) return;
    let cancelled = false;
    async function check() {
      const result: MonthConflict[] = [];
      for (const m of analysis!.months) {
        const { count } = await supabase
          .from("production_actuals")
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

  async function handleImport() {
    if (!parsed.length || !analysis) return;
    if (monthConflicts.length > 0 && !replaceConfirmed) return;

    setImporting(true);
    setProgress(0);

    // Production n'a pas de clé unique : supprimer les mois en conflit avant d'importer
    if (monthConflicts.length > 0) {
      for (const { month } of monthConflicts) {
        await supabase.from("production_actuals").delete().eq("period_month", month);
      }
    }

    const months = analysis.months;
    const periodStart = months[0] ? `${months[0]}-01` : new Date().toISOString().slice(0, 10);
    const periodEnd = months[months.length - 1]
      ? `${months[months.length - 1]}-28`
      : periodStart;

    const { data: batch, error: batchErr } = await supabase.from("import_batches").insert({
      import_type: "S8_PRODUCTION",
      source_system: "S8",
      period_start: periodStart,
      period_end: periodEnd,
      file_name: fileName,
      row_count: parsed.length,
      status: "processing",
    }).select().single();

    if (batchErr || !batch) {
      alert("Erreur batch: " + batchErr?.message);
      setImporting(false);
      return;
    }

    const CHUNK = 100;
    let success = 0;
    let errors = 0;

    for (let i = 0; i < parsed.length; i += CHUNK) {
      const chunk = parsed.slice(i, i + CHUNK);
      const rows = chunk.map((p) => ({
        import_batch_id: batch.id,
        bom_number: p.bom,
        item_code: p.itemCode,
        item_code_matched: p.itemMatched,
        series: p.series,
        quantity: p.quantity,
        actual_minutes: p.actualMinutes,
        standard_minutes_per_unit: p.standardMinutesPerUnit,
        actual_minutes_per_unit: p.actualMinutesPerUnit,
        target_minutes: p.targetMinutes,
        ratio: p.ratio,
        period_month: p.periodMonth ?? months[0] ?? new Date().toISOString().slice(0, 7),
        last_updated_at: p.lastUpdatedAt,
        included_in_kpi: p.includedInKpi,
        exclusion_reason: p.exclusionReason,
      }));

      const { error } = await supabase.from("production_actuals").insert(rows);
      if (error) {
        for (const row of rows) {
          const { error: rowErr } = await supabase.from("production_actuals").insert(row);
          if (rowErr) errors++;
          else success++;
        }
      } else {
        success += rows.length;
      }
      setProgress(Math.min(99, Math.round(((i + CHUNK) / parsed.length) * 100)));
    }

    await supabase.from("import_batches").update({
      status: errors === 0 ? "completed" : "failed",
      row_count: success,
    }).eq("id", batch.id);

    setProgress(100);
    setImporting(false);
    setResult({ success, errors });
  }

  function reset() {
    setFileName(null);
    setParsed([]);
    setAnalysis(null);
    setResult(null);
    setShowExcluded(false);
    setCopiedUnmatched(false);
    setNeedsManualMonth(false);
    setMonthConflicts([]);
    setReplaceConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function downloadExclusionsExcel() {
    if (!parsed.length) return;

    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();

    const toRow = (p: ParsedProduction) => ({
      BOM: p.bom ?? "",
      Item: p.itemCode,
      "Item matché": p.itemMatched ?? "",
      Série: p.series,
      Quantité: p.quantity,
      "Temps réel (min)": Math.round(p.actualMinutes * 100) / 100,
      "Temps réel": formatMinutes(p.actualMinutes),
      "Std min/unité": p.standardMinutesPerUnit ?? "",
      "Cible (min)": p.targetMinutes != null ? Math.round(p.targetMinutes * 100) / 100 : "",
      "Réel min/unité": p.actualMinutesPerUnit != null ? Math.round(p.actualMinutesPerUnit * 1000) / 1000 : "",
      "Ratio vs std": p.ratio != null ? Math.round(p.ratio * 100) / 100 : "",
      Mois: p.periodMonth ?? "",
      "Dernière mise à jour": p.lastUpdatedAt ?? "",
      Exclusion: EXCLUSION_LABELS[p.exclusionReason],
    });

    const sheets: { name: string; reason: ExclusionReason }[] = [
      { name: "Items sans standard", reason: "standard_manquant" },
      { name: "Trop long (>10x)", reason: "trop_lent" },
      { name: "Trop vite (<10%)", reason: "trop_rapide" },
    ];

    for (const { name, reason } of sheets) {
      const rows = parsed.filter((p) => p.exclusionReason === reason).map(toRow);
      const ws = XLSX.utils.json_to_sheet(
        rows.length > 0
          ? rows
          : [{ Message: "Aucune exclusion de ce type dans ce fichier" }]
      );
      XLSX.utils.book_append_sheet(book, ws, name);
    }

    const base = (fileName ?? "production").replace(/\.[^.]+$/, "");
    XLSX.writeFile(book, `${base} — exclusions.xlsx`);
  }

  const noStandards = refLoaded && standards.length === 0;
  const lowStandards = refLoaded && standards.length > 0 && standards.length < 5000;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Import — Temps par BOM"
        subtitle="Excel : BOM, Item, Quantité, Temps (HH:MM:SS), Dernière mise à jour"
      />

      {refLoaded && standards.length > 0 && (
        <div className={cn(
          "mb-5 p-3 border rounded-xl flex gap-3",
          lowStandards ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"
        )}>
          <FileSpreadsheet className={cn("w-4 h-4 flex-shrink-0 mt-0.5", lowStandards ? "text-amber-500" : "text-slate-500")} />
          <p className={cn("text-sm", lowStandards ? "text-amber-800" : "text-slate-600")}>
            <span className="font-semibold">{standards.length.toLocaleString("fr-CA")} standards</span> chargés depuis Supabase
            {lowStandards && " — nombre plus bas que prévu (~6 000). Vérifiez l'import standards."}
          </p>
        </div>
      )}

      {standardsError && (
        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">Erreur chargement standards : {standardsError}</p>
        </div>
      )}

      {noStandards && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Aucun temps standard importé. Importez d&apos;abord la liste des standards.
          </p>
        </div>
      )}

      {!analysis && !result && !importing && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center cursor-pointer hover:border-purple-300 hover:bg-slate-50"
        >
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
          {parsing ? (
            <p className="text-slate-500">Analyse en cours…</p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-10 h-10 text-purple-500" />
              <p className="font-semibold text-slate-700">Sélectionner le fichier Excel de production</p>
              <p className="text-xs text-slate-400">Multi-mois OK — le mois est déduit de la date</p>
            </div>
          )}
        </div>
      )}

      {importing && (
        <div className="bg-white border rounded-xl p-6 space-y-3">
          <p className="font-medium">Import en cours… {progress}%</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className={cn("p-5 rounded-xl border-2 flex gap-3",
            result.errors === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200")}>
            <CheckCircle2 className="w-6 h-6 text-green-500" />
            <div>
              <p className="font-semibold">{result.success} lignes importées</p>
              {result.errors > 0 && <p className="text-sm text-red-600">{result.errors} erreurs</p>}
            </div>
          </div>
          <Button variant="secondary" onClick={reset}><RotateCcw className="w-3.5 h-3.5" /> Autre fichier</Button>
        </div>
      )}

      {analysis && !importing && !result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-white border rounded-xl">
            <FileSpreadsheet className="w-5 h-5 text-purple-500" />
            <div className="flex-1">
              <p className="text-sm font-medium">{fileName}</p>
              <p className="text-xs text-slate-400">
                {analysis.total} lignes · Mois : {analysis.months.join(", ") || manualMonth}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>×</Button>
          </div>

          {needsManualMonth && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-sm font-medium text-blue-800 mb-2">
                Aucune colonne date détectée — choisissez le mois de ce fichier
              </p>
              <input
                type="month"
                value={manualMonth}
                onChange={(e) => {
                  setManualMonth(e.target.value);
                  setParsed((prev) => prev.map((p) => ({ ...p, periodMonth: e.target.value })));
                  setAnalysis((prev) => prev ? { ...prev, months: [e.target.value] } : prev);
                }}
                className="rounded-lg border border-blue-300 px-3 py-2 text-sm bg-white"
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Incluses KPI" value={analysis.included} color="green" />
            <StatCard label="Exclues" value={analysis.excluded} color="amber" />
            <StatCard
              label="Taux exclusion"
              value={analysis.total > 0 ? `${Math.round((analysis.excluded / analysis.total) * 100)}%` : "—"}
              color="slate"
            />
          </div>

          <div className="bg-white border rounded-xl p-4">
            <button
              className="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
              onClick={() => setShowExcluded((v) => !v)}
            >
              <span>Détail des exclusions ({analysis.excluded})</span>
              {showExcluded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showExcluded && (
              <div className="mt-3 space-y-2">
                {Object.entries(analysis.byReason).map(([reason, count]) => (
                  <div key={reason} className="flex justify-between text-sm px-3 py-2 bg-amber-50 rounded-lg">
                    <span>{EXCLUSION_LABELS[reason as ExclusionReason] ?? reason}</span>
                    <span className="font-semibold text-amber-700">{count}</span>
                  </div>
                ))}
                {analysis.unmatchedItems.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-100">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-xs font-semibold text-slate-600">
                        Items sans standard : {analysis.unmatchedItems.length} codes uniques
                        {analysis.byReason.standard_manquant != null && (
                          <span className="font-normal text-slate-400">
                            {" "}({analysis.byReason.standard_manquant} lignes)
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          const text = analysis.unmatchedItems
                            .map((i) => `${i.code}\t${i.lines}\t${i.quantity}`)
                            .join("\n");
                          await navigator.clipboard.writeText(`Code\tLignes\tQté\n${text}`);
                          setCopiedUnmatched(true);
                          setTimeout(() => setCopiedUnmatched(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary"
                      >
                        {copiedUnmatched ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedUnmatched ? "Copié" : "Copier tout"}
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto bg-slate-50 rounded-lg border border-slate-100">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-100 text-slate-500">
                          <tr>
                            <th className="text-left font-semibold px-3 py-2">Code item</th>
                            <th className="text-right font-semibold px-3 py-2">Lignes</th>
                            <th className="text-right font-semibold px-3 py-2">Qté totale</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-slate-700 divide-y divide-slate-100">
                          {analysis.unmatchedItems.map((item) => (
                            <tr key={item.code} className="hover:bg-white">
                              <td className="px-3 py-1.5">{item.code}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{item.lines}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{item.quantity.toLocaleString("fr-CA")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Ces codes n&apos;ont aucun match dans les {standards.length.toLocaleString("fr-CA")} standards actifs.
                      Vérifie l&apos;orthographe / les zéros (ex. 15 vs 150) ou ajoute le standard manquant.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {monthConflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">
                  Données production déjà importées — remplacement obligatoire
                </p>
                <p className="text-xs text-red-700 mt-1">
                  Contrairement aux autres sources, la production n&apos;a pas de clé unique par ligne.
                  Si vous importez sans supprimer, toutes les lignes seront dupliquées.
                </p>
                <ul className="mt-2 text-xs text-red-700 space-y-0.5">
                  {monthConflicts.map((c) => (
                    <li key={c.month}>{fmtMonth(c.month)} — {c.count.toLocaleString("fr-CA")} lignes existantes</li>
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
                    Je confirme supprimer les {monthConflicts.reduce((s, c) => s + c.count, 0).toLocaleString("fr-CA")} lignes existantes et les remplacer
                  </span>
                </label>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {(analysis.byReason.standard_manquant ||
              analysis.byReason.trop_lent ||
              analysis.byReason.trop_rapide) && (
              <Button variant="secondary" onClick={downloadExclusionsExcel}>
                <Download className="w-4 h-4" /> Exporter exclusions Excel
              </Button>
            )}
            <Button
              onClick={handleImport}
              disabled={monthConflicts.length > 0 && !replaceConfirmed}
            >
              {monthConflicts.length > 0 ? "Remplacer et importer" : "Importer"}{" "}
              {analysis.total} lignes <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: "green" | "amber" | "slate" }) {
  const colors = {
    green: "bg-green-50 border-green-100",
    amber: "bg-amber-50 border-amber-100",
    slate: "bg-slate-50 border-slate-200",
  };
  return (
    <div className={cn("rounded-xl border p-4", colors[color])}>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
