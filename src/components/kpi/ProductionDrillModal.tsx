"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { cn } from "@/lib/utils";
import {
  type FocusItem,
  formatMinutes,
  formatUnitMinutes,
  normalizeBom,
  soloBomIds,
} from "@/lib/production";

type LogLine = {
  id: string;
  id_sap: string;
  itemcode: string;
  bom: string | null;
  quantity: number;
  timestamp_begin: string | null;
  timestamp_end: string | null;
  duration_minutes: number | null;
  period_month: string;
};

type EmployeeGroup = {
  idSap: string;
  lineCount: number;
  totalQuantity: number;
  totalDurationMinutes: number;
  lines: LogLine[];
  solo: boolean;
};

type BomGroup = {
  bom: string;
  solo: boolean;
  lineCount: number;
  totalQuantity: number;
  totalDurationMinutes: number;
  employees: EmployeeGroup[];
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

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${day} ${h}:${min}`;
}

function fmtDuration(minutes: number | null): string {
  if (minutes == null || !isFinite(minutes)) return "—";
  return formatMinutes(minutes);
}

function initials(name: string): string {
  const parts = name.replace(/^#/, "").split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function groupLines(lines: LogLine[], solo: Set<string>): BomGroup[] {
  const bomMap = new Map<string, BomGroup>();

  for (const line of lines) {
    const key = normalizeBom(line.bom) ?? "(sans BOM)";
    let bom = bomMap.get(key);
    if (!bom) {
      bom = {
        bom: key,
        solo: key !== "(sans BOM)" && solo.has(key),
        lineCount: 0,
        totalQuantity: 0,
        totalDurationMinutes: 0,
        employees: [],
      };
      bomMap.set(key, bom);
    }
    bom.lineCount += 1;
    bom.totalQuantity += Number(line.quantity) || 0;
    bom.totalDurationMinutes += Number(line.duration_minutes) || 0;

    let emp = bom.employees.find((e) => e.idSap === line.id_sap);
    if (!emp) {
      emp = {
        idSap: line.id_sap,
        lineCount: 0,
        totalQuantity: 0,
        totalDurationMinutes: 0,
        lines: [],
        solo: bom.solo,
      };
      bom.employees.push(emp);
    }
    emp.lineCount += 1;
    emp.totalQuantity += Number(line.quantity) || 0;
    emp.totalDurationMinutes += Number(line.duration_minutes) || 0;
    emp.lines.push(line);
  }

  const result = [...bomMap.values()].sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes);
  for (const bom of result) {
    bom.employees.sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes);
    for (const emp of bom.employees) {
      emp.lines.sort((a, b) => {
        const ta = a.timestamp_begin ? new Date(a.timestamp_begin).getTime() : 0;
        const tb = b.timestamp_begin ? new Date(b.timestamp_begin).getTime() : 0;
        return ta - tb;
      });
    }
  }
  return result;
}

async function fetchOwners(
  supabase: ReturnType<typeof createClient>,
  boms: string[]
): Promise<{ bom: string | null; id_sap: string }[]> {
  const rows: { bom: string | null; id_sap: string }[] = [];
  const chunkSize = 80;
  for (let i = 0; i < boms.length; i += chunkSize) {
    const chunk = boms.slice(i, i + chunkSize);
    const { data } = await fetchAllRows<{ bom: string | null; id_sap: string }>((from, to) =>
      supabase
        .from("production_log_lines")
        .select("bom, id_sap")
        .in("bom", chunk)
        .range(from, to)
    );
    rows.push(...data);
  }
  return rows;
}

/** Cible − réel. Négatif = au-dessus du standard. */
function ecartMinutes(quantity: number, minutes: number, standardPerUnit: number | null): number | null {
  if (standardPerUnit == null || standardPerUnit <= 0 || quantity <= 0) return null;
  return quantity * standardPerUnit - minutes;
}

function fmtEcart(minutes: number): string {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "";
  return `${sign}${formatMinutes(Math.abs(minutes))}`;
}

interface Props {
  item: FocusItem;
  months: string[];
  onClose: () => void;
}

export function ProductionDrillModal({ item, months, onClose }: Props) {
  const supabase = createClient();
  const backdropRef = useRef<HTMLDivElement>(null);

  const [lines, setLines] = useState<LogLine[]>([]);
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [standardPerUnit, setStandardPerUnit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [empNames, setEmpNames] = useState<Map<string, string>>(new Map());
  const [openBoms, setOpenBoms] = useState<Set<string>>(new Set());
  const [openEmps, setOpenEmps] = useState<Set<string>>(new Set());
  const [soloOnly, setSoloOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLines([]);
    setSolo(new Set());
    setOpenBoms(new Set());
    setOpenEmps(new Set());

    async function load() {
      const [{ data: logData }, { data: mappingData }, { data: standardRow }] = await Promise.all([
        fetchAllRows<LogLine>((from, to) => {
          let q = supabase
            .from("production_log_lines")
            .select("id, id_sap, itemcode, bom, quantity, timestamp_begin, timestamp_end, duration_minutes, period_month")
            .eq("itemcode", item.itemCode)
            .order("timestamp_begin", { ascending: true })
            .range(from, to);
          if (months.length === 1) q = q.eq("period_month", months[0]!);
          else if (months.length > 1) q = q.in("period_month", months);
          return q;
        }),
        fetchAllRows<{
          external_employee_code: string | null;
          employees: { full_name: string } | { full_name: string }[] | null;
        }>(
          (from, to) =>
            supabase
              .from("employee_system_mapping")
              .select("external_employee_code, employees(full_name)")
              .eq("system_name", "SAP")
              .eq("is_active", true)
              .range(from, to)
        ),
        supabase
          .from("production_standards")
          .select("standard_minutes_per_unit")
          .eq("item_code", item.itemCode)
          .limit(1)
          .maybeSingle(),
      ]);

      const boms = [...new Set(logData.map((l) => normalizeBom(l.bom)).filter((b): b is string => !!b))];
      const owners = boms.length > 0 ? await fetchOwners(supabase, boms) : [];

      if (cancelled) return;

      const nameMap = new Map<string, string>();
      for (const m of mappingData) {
        const linked = m.employees;
        const fullName = Array.isArray(linked) ? linked[0]?.full_name : linked?.full_name;
        if (m.external_employee_code && fullName) nameMap.set(m.external_employee_code, fullName);
      }
      setEmpNames(nameMap);
      setLines(logData);
      setSolo(soloBomIds(owners));
      const std = Number(standardRow?.standard_minutes_per_unit);
      setStandardPerUnit(Number.isFinite(std) && std > 0 ? std : null);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [item.itemCode, months.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const list = groupLines(lines, solo);
    const withEcart = list.map((bom) => ({
      bom,
      ecart: ecartMinutes(bom.totalQuantity, bom.totalDurationMinutes, standardPerUnit),
    }));
    const problems = withEcart.filter((row) => row.ecart != null && row.ecart < 0);
    const source = problems.length > 0 ? problems : withEcart;
    source.sort((a, b) => {
      if (a.ecart == null && b.ecart == null) return 0;
      if (a.ecart == null) return 1;
      if (b.ecart == null) return -1;
      return a.ecart - b.ecart;
    });
    const ranked = source.map((row) => row.bom);
    return soloOnly ? ranked.filter((bom) => bom.solo) : ranked;
  }, [lines, solo, standardPerUnit, soloOnly]);

  function nameOf(idSap: string): string {
    return empNames.get(idSap) ?? `#${idSap}`;
  }

  function toggleBom(key: string) {
    setOpenBoms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleEmp(key: string) {
    setOpenEmps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const periodLabel = months.length === 1
    ? fmtMonth(months[0]!)
    : months.length > 1
      ? `${months.length} mois`
      : "—";

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs bg-[#fde8ec] text-primary px-2 py-0.5 rounded-full font-medium">
                Série {item.series}
              </span>
              <span className="text-xs text-slate-400">{periodLabel}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 font-mono">{item.itemCode}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Écart = cible − réel (tri). Les temps unitaires montrent le rythme réel vs le standard.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400">Réel / u</p>
                <p className="font-semibold tabular-nums text-slate-800">
                  {item.quantity > 0
                    ? formatUnitMinutes(item.actualMinutes / item.quantity)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400">Cible / u</p>
                <p className="font-semibold tabular-nums text-slate-600">
                  {standardPerUnit != null
                    ? formatUnitMinutes(standardPerUnit)
                    : item.quantity > 0 && item.targetMinutes > 0
                      ? formatUnitMinutes(item.targetMinutes / item.quantity)
                      : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400">Écart total</p>
                <p className={cn(
                  "font-semibold tabular-nums",
                  item.varianceMinutes > 0 ? "text-[#047857]" :
                  item.varianceMinutes < 0 ? "text-primary" : "text-slate-500"
                )}>
                  {item.targetMinutes > 0 ? fmtEcart(item.varianceMinutes) : "—"}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Chargement des logs…</span>
            </div>
          ) : lines.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-slate-500 font-medium">Aucun log Prod employé pour cet item</p>
              <p className="text-xs text-slate-400 mt-1">Le total du mois reste celui de la page Production.</p>
            </div>
          ) : (
            <div className="px-6 py-4">
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {groups.length === 0
                      ? "Aucun BOM"
                      : groups.every((bom) => {
                          const ecart = ecartMinutes(bom.totalQuantity, bom.totalDurationMinutes, standardPerUnit);
                          return ecart != null && ecart < 0;
                        })
                        ? `${groups.length} BOM${groups.length > 1 ? "s" : ""} au-dessus du standard`
                        : `${groups.length} BOM${groups.length > 1 ? "s" : ""}`}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSoloOnly((on) => !on)}
                    className={cn(
                      "text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors",
                      soloOnly
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    BOM solo
                  </button>
                </div>
                {groups.length === 0 ? (
                  <p className="text-sm text-slate-500">Aucun BOM solo au-dessus du standard pour cet item.</p>
                ) : groups.map((bom) => {
                  const bomOpen = openBoms.has(bom.bom);
                  const bomEcart = ecartMinutes(bom.totalQuantity, bom.totalDurationMinutes, standardPerUnit);
                  const bomBad = bomEcart != null && bomEcart < 0;
                  const bomGood = bomEcart != null && bomEcart >= 0;
                  return (
                    <div key={bom.bom}>
                      <button
                        onClick={() => toggleBom(bom.bom)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-left transition-colors hover:bg-slate-100"
                      >
                        <ChevronDown className={cn("w-5 h-5 text-slate-500 flex-shrink-0 transition-transform", bomOpen ? "" : "-rotate-90")} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">BOM</p>
                          <p className="text-base font-semibold font-mono leading-tight text-slate-900">{bom.bom}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="text-[11px] bg-white/80 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                              {bom.employees.length} employé{bom.employees.length > 1 ? "s" : ""}
                            </span>
                            <span className="text-[11px] bg-white/80 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                              {bom.totalQuantity.toLocaleString("fr-CA")} unités
                            </span>
                            {bom.totalQuantity > 0 && (
                              <span className="text-[11px] bg-white/80 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                                {formatUnitMinutes(bom.totalDurationMinutes / bom.totalQuantity)} / u
                                {standardPerUnit != null && (
                                  <span className="text-slate-400"> · cible {formatUnitMinutes(standardPerUnit)}</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 space-y-1">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-slate-500">Écart vs standard</p>
                            <p className={cn(
                              "text-base font-semibold tabular-nums",
                              bomBad && "text-primary",
                              bomGood && "text-[#047857]",
                              bomEcart == null && "text-slate-400"
                            )}>
                              {bomEcart == null ? "—" : fmtEcart(bomEcart)}
                            </p>
                          </div>
                        </div>
                      </button>

                      {bomOpen && (
                        <div className="ml-4 mt-2 mb-1 pl-4 border-l-2 border-slate-300">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Employés</p>
                          <div className="space-y-2">
                          {bom.employees.map((emp) => {
                            const empKey = `${bom.bom}::${emp.idSap}`;
                            const empOpen = openEmps.has(empKey);
                            const personEcart = emp.solo
                              ? ecartMinutes(emp.totalQuantity, emp.totalDurationMinutes, standardPerUnit)
                              : null;
                            const label = nameOf(emp.idSap);
                            const personBad = personEcart != null && personEcart < 0;
                            const personGood = personEcart != null && personEcart >= 0;
                            return (
                              <div key={emp.idSap} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => toggleEmp(empKey)}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                                >
                                  <ChevronDown className={cn("w-4 h-4 text-slate-300 flex-shrink-0 transition-transform", empOpen ? "" : "-rotate-90")} />
                                  <span className={cn(
                                    "w-2.5 h-2.5 rounded-full flex-shrink-0",
                                    personBad && "bg-primary",
                                    personGood && "bg-[#047857]",
                                    personEcart == null && "bg-slate-300"
                                  )} />
                                  <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                                    {initials(label)}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-800">{label}</p>
                                    <p className="text-xs text-slate-400">
                                      {empNames.has(emp.idSap) && <span className="font-mono mr-1.5">#{emp.idSap} ·</span>}
                                      {emp.totalQuantity.toLocaleString("fr-CA")} unités
                                      {!emp.solo && " · partagé"}
                                      {emp.totalQuantity > 0 && (
                                        <>
                                          {" · "}
                                          <span className="text-slate-600">
                                            {formatUnitMinutes(emp.totalDurationMinutes / emp.totalQuantity)} / u
                                          </span>
                                          {standardPerUnit != null && (
                                            <span className="text-slate-400">
                                              {" "}(cible {formatUnitMinutes(standardPerUnit)})
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </p>
                                  </div>
                                  <span className={cn(
                                    "text-sm font-semibold tabular-nums px-2 py-1 rounded-md flex-shrink-0",
                                    personBad && "bg-[#fde8ec] text-primary",
                                    personGood && "bg-[#ecfdf5] text-[#047857]",
                                    personEcart == null && "bg-slate-100 text-slate-400 text-xs font-medium"
                                  )}>
                                    {personEcart == null ? (emp.solo ? "Fermé à 0" : "Partagé") : fmtEcart(personEcart)}
                                  </span>
                                </button>

                                {empOpen && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="bg-slate-100/70 text-slate-500 uppercase text-[10px] font-semibold tracking-wide">
                                          <th className="px-6 py-2 text-left">Début</th>
                                          <th className="px-3 py-2 text-left">Fin</th>
                                          <th className="px-3 py-2 text-right">Durée</th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-slate-50">
                                        {emp.lines.map((line) => (
                                          <tr key={line.id}>
                                            <td className="px-6 py-2 font-mono text-slate-500 whitespace-nowrap">{fmtTimestamp(line.timestamp_begin)}</td>
                                            <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{fmtTimestamp(line.timestamp_end)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-slate-700 font-medium">{fmtDuration(line.duration_minutes)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-slate-400">
            Prod employé
            {lines.length > 0 && <> · {lines.length.toLocaleString("fr-CA")} lignes</>}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
