"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, TrendingDown, TrendingUp,
  AlertTriangle, Factory, Search, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import {
  computeProductionSummary,
  computeSeriesSummaries,
  computeItemSummaries,
  computeFocusItems,
  searchProductionItems,
  formatMinutes,
  formatUnitMinutes,
  formatPct,
  type FocusItem,
  EXCLUSION_LABELS,
  type ExclusionReason,
} from "@/lib/production";
import { ProductionDrillModal } from "@/components/kpi/ProductionDrillModal";

type ProdRow = {
  id: string;
  item_code: string;
  item_code_matched: string | null;
  series: string;
  quantity: number;
  actual_minutes: number;
  target_minutes: number | null;
  ratio: number | null;
  included_in_kpi: boolean;
  exclusion_reason: string | null;
  period_month: string;
};

const MONTH_LABELS: Record<string, string> = {
  "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
  "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
  "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m ?? ""] ?? m} ${y}`;
}

const LAST_12 = "last-12";

export default function KpiProductionPage() {
  const supabase = createClient();
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(LAST_12);
  const [rows, setRows] = useState<ProdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [selectedFocusItem, setSelectedFocusItem] = useState<FocusItem | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);

  const loadMonths = useCallback(async () => {
    const { data } = await fetchAllRows<{ period_month: string }>((from, to) =>
      supabase
        .from("production_actuals")
        .select("period_month")
        .order("period_month", { ascending: false })
        .range(from, to)
    );

    const unique = [...new Set(data.map((d) => d.period_month))];
    setMonths(unique);
    setLoading(false);
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);

    const isLast12 = selectedMonth === LAST_12;
    let periodFilter: (q: any) => any;

    if (isLast12) {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
      periodFilter = (q: any) => q.gte("period_month", cutoffMonth);
    } else {
      periodFilter = (q: any) => q.eq("period_month", selectedMonth);
    }

    const { data } = await fetchAllRows<ProdRow>((from, to) =>
      periodFilter(
        supabase
          .from("production_actuals")
          .select("id, item_code, item_code_matched, series, quantity, actual_minutes, target_minutes, ratio, included_in_kpi, exclusion_reason, period_month")
      ).range(from, to)
    );
    setRows(data);
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => { loadMonths(); }, [loadMonths]);
  useEffect(() => { if (selectedMonth) loadData(); }, [selectedMonth, loadData]);

  const summary = computeProductionSummary(rows);
  const seriesList = computeSeriesSummaries(rows);
  const focusItems = useMemo(() => computeFocusItems(rows), [rows]);
  const isSearching = itemQuery.trim().length > 0;
  const searchedItems = useMemo(
    () => (isSearching ? searchProductionItems(rows, itemQuery) : []),
    [rows, itemQuery, isSearching]
  );
  const displayedItems = isSearching ? searchedItems : focusItems;
  const visibleSeries = useMemo(() => {
    if (!isSearching) return seriesList;
    const seriesWithHits = new Set(searchedItems.map((item) => item.series));
    return seriesList.filter((s) => seriesWithHits.has(s.series));
  }, [isSearching, seriesList, searchedItems]);

  const isGood = summary.varianceMinutes >= 0;
  const query = itemQuery.trim().toLowerCase();

  // Calcule les mois actifs à passer au modal de drill-down
  const activeMonths = useMemo(() => {
    if (selectedMonth === LAST_12) {
      return [...new Set(rows.map((r) => r.period_month).filter(Boolean))].sort();
    }
    return [selectedMonth];
  }, [selectedMonth, rows]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="KPI — Production"
        subtitle="Temps réel vs temps cible par mois et par série"
      />

      {/* Sélecteur de mois */}
      {months.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {months.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                selectedMonth === m
                  ? "bg-purple-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {monthLabel(m)}
            </button>
          ))}
          <button
            onClick={() => setSelectedMonth(LAST_12)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              selectedMonth === LAST_12
                ? "bg-purple-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            12 derniers mois
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <Factory className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
          <p className="text-sm text-slate-400 mt-1">
            Importez les temps standards puis les logs de production.
          </p>
        </div>
      ) : (
        <>
          {/* Cartes KPI mensuelles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Temps réel" value={formatMinutes(summary.actualMinutes)} />
            <KpiCard label="Temps cible (imputé)" value={formatMinutes(summary.targetMinutes)} />
            <KpiCard
              label="Écart"
              value={formatMinutes(Math.abs(summary.varianceMinutes))}
              sub={summary.varianceMinutes >= 0 ? "Sous le cible ✓" : "Au-dessus du cible"}
              color={isGood ? "green" : "amber"}
              icon={isGood ? TrendingUp : TrendingDown}
            />
            <KpiCard
              label="% écart"
              value={formatPct(summary.variancePct)}
              sub="(cible − réel) / cible"
              color={isGood ? "green" : "amber"}
            />
          </div>

          {/* KPI exclusions */}
          <div className="bg-white border border-slate-200 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => setQualityOpen((open) => !open)}
              className="w-full flex items-center gap-2 px-5 py-4 text-left"
            >
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-700 flex-1">Qualité des données — exclusions</h3>
              <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", qualityOpen && "rotate-180")} />
            </button>
            {qualityOpen && (
              <div className="px-5 pb-5">
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xl font-bold text-slate-700">{summary.totalLines}</p>
                    <p className="text-xs text-slate-500">Lignes importées</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-xl font-bold text-green-700">{summary.includedLines}</p>
                    <p className="text-xs text-green-600">Incluses KPI</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg">
                    <p className="text-xl font-bold text-amber-700">{summary.excludedLines}</p>
                    <p className="text-xs text-amber-600">Exclues</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xl font-bold text-slate-600">
                      {summary.totalLines > 0
                        ? `${Math.round((summary.excludedLines / summary.totalLines) * 100)}%`
                        : "—"}
                    </p>
                    <p className="text-xs text-slate-500">Taux exclusion</p>
                  </div>
                </div>
                {Object.keys(summary.exclusionsByReason).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(summary.exclusionsByReason).map(([reason, count]) => (
                      <span key={reason} className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full font-medium">
                        {EXCLUSION_LABELS[reason as ExclusionReason] ?? reason} : {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher un item…"
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-slate-400"
            />
            {itemQuery && (
              <button
                type="button"
                onClick={() => setItemQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="Effacer la recherche"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">
                {isSearching ? "Recherche d'item" : "Items à focus"}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {isSearching
                  ? `${displayedItems.length} résultat${displayedItems.length > 1 ? "s" : ""} pour « ${itemQuery.trim()} »`
                  : "Temps unitaire réel vs standard, classés par pire perte de temps totale"}
              </p>
            </div>
            {displayedItems.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">
                {isSearching
                  ? "Aucun item trouvé pour cette période."
                  : "Aucun item au-dessus du temps standard."}
              </p>
            ) : (
              <ItemCompactTable
                items={displayedItems}
                signedVariance={isSearching}
                onItemClick={setSelectedFocusItem}
              />
            )}
          </div>

          {/* Drill-down par série */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">
                Performance par série ({visibleSeries.length} série{visibleSeries.length > 1 ? "s" : ""})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {isSearching
                  ? "Séries contenant l'item recherché, déjà ouvertes"
                  : "Classé du moins performant au plus performant"}
              </p>
            </div>

            {visibleSeries.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">
                Aucune série ne contient cet item.
              </p>
            ) : (
            <div className="divide-y divide-slate-100">
              {visibleSeries.map((s) => {
                const isOpen = isSearching || expandedSeries === s.series;
                const sGood = s.varianceMinutes >= 0;
                const itemRows = isOpen
                  ? computeItemSummaries(
                      rows.filter((r) => r.series === s.series),
                      s.series
                    ).filter((item) =>
                      !isSearching || item.itemCode.toLowerCase().includes(query)
                    )
                  : [];

                return (
                  <div key={s.series}>
                    <button
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                      onClick={() => setExpandedSeries(isOpen ? null : s.series)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-bold">
                          {s.series}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Série {s.series}</p>
                          <p className="text-xs text-slate-400">{s.lineCount} lignes · {formatMinutes(s.actualMinutes)} réel</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className={cn("text-sm font-bold", sGood ? "text-green-600" : "text-amber-600")}>
                            {formatPct(s.variancePct)}
                          </p>
                          <p className="text-xs text-slate-400">
                            {sGood ? "Sous cible" : "Sur cible"} · {formatMinutes(Math.abs(s.varianceMinutes))}
                          </p>
                        </div>
                        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-5 pb-4 bg-slate-50 border-t border-slate-100">
                        <table className="w-full text-sm mt-3">
                          <thead>
                            <tr className="text-xs font-semibold text-slate-500 uppercase">
                              <th className="text-left pb-2">Item</th>
                              <th className="text-right pb-2">Prod.</th>
                              <th className="text-right pb-2">Qté</th>
                              <th className="text-right pb-2">Réel</th>
                              <th className="text-right pb-2">Cible</th>
                              <th className="text-right pb-2">Écart</th>
                              <th className="text-right pb-2">%</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {itemRows.map((item) => {
                              const iGood = item.varianceMinutes >= 0;
                              return (
                                <tr key={item.itemCode} className="hover:bg-white">
                                  <td className="py-2 font-medium text-slate-800">{item.itemCode}</td>
                                  <td className="py-2 text-right text-slate-600">{item.productionCount}</td>
                                  <td className="py-2 text-right text-slate-600">{item.quantity}</td>
                                  <td className="py-2 text-right text-slate-600">{formatMinutes(item.actualMinutes)}</td>
                                  <td className="py-2 text-right text-slate-600">{formatMinutes(item.targetMinutes)}</td>
                                  <td className={cn("py-2 text-right font-medium", iGood ? "text-green-600" : "text-amber-600")}>
                                    {iGood ? "+" : "−"}{formatMinutes(Math.abs(item.varianceMinutes))}
                                  </td>
                                  <td className={cn("py-2 text-right font-semibold", iGood ? "text-green-600" : "text-amber-600")}>
                                    {formatPct(item.variancePct)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </>
      )}

      {/* Modal drill-down */}
      {selectedFocusItem && (
        <ProductionDrillModal
          item={selectedFocusItem}
          months={activeMonths}
          onClose={() => setSelectedFocusItem(null)}
        />
      )}
    </div>
  );
}

function ItemCompactTable({
  items,
  signedVariance,
  onItemClick,
}: {
  items: FocusItem[];
  signedVariance: boolean;
  onItemClick?: (item: FocusItem) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
            <th className="text-left px-5 py-2">Item</th>
            <th className="text-right px-3 py-2">Quantité</th>
            <th className="text-right px-3 py-2">Unitaire</th>
            <th className="text-right px-5 py-2">Écart</th>
            {onItemClick && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => {
            const actualPerUnit = item.quantity > 0 ? item.actualMinutes / item.quantity : 0;
            const targetPerUnit = item.quantity > 0 ? item.targetMinutes / item.quantity : 0;
            const good = item.varianceMinutes >= 0;
            const varianceColor = good ? "text-green-600" : "text-amber-600";
            return (
              <tr
                key={`${item.series}::${item.itemCode}`}
                className={cn(
                  "hover:bg-slate-50",
                  onItemClick && "cursor-pointer group"
                )}
                onClick={() => onItemClick?.(item)}
              >
                <td className="px-5 py-2 font-medium text-slate-800 group-hover:text-purple-700 transition-colors">
                  {item.itemCode}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="tabular-nums text-slate-800">{item.quantity.toLocaleString("fr-CA")}</span>
                  <span className="block text-xs text-slate-400 tabular-nums">
                    {item.productionCount} prod.
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="tabular-nums text-slate-800">{formatUnitMinutes(actualPerUnit)}</span>
                  <span className="block text-xs text-slate-400 tabular-nums">cible {formatUnitMinutes(targetPerUnit)}</span>
                </td>
                <td className="px-5 py-2 text-right">
                  <span className={cn("tabular-nums font-medium", varianceColor)}>
                    {signedVariance
                      ? `${good ? "+" : "−"}${formatMinutes(Math.abs(item.varianceMinutes))}`
                      : `−${formatMinutes(Math.abs(item.varianceMinutes))}`}
                  </span>
                  <span className={cn("block text-xs tabular-nums", good ? "text-green-500" : "text-amber-500")}>
                    {formatPct(item.variancePct)}
                  </span>
                </td>
                {onItemClick && (
                  <td className="px-3 py-2 text-right">
                    <span className="text-xs text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium whitespace-nowrap">
                      Voir détails →
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KpiCard({
  label, value, sub, color, icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "green" | "amber";
  icon?: React.ElementType;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-5",
      color === "green" ? "bg-green-50 border-green-200" :
      color === "amber" ? "bg-amber-50 border-amber-200" :
                          "bg-white border-slate-200"
    )}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon className={cn("w-4 h-4", color === "green" ? "text-green-500" : color === "amber" ? "text-amber-500" : "text-slate-400")} />}
      </div>
      <p className={cn("text-2xl font-bold", color === "green" ? "text-green-700" : color === "amber" ? "text-amber-700" : "text-slate-900")}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
