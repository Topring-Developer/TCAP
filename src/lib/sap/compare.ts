import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { EmployeeMapping } from "@/lib/inventory";
import {
  fetchInventory,
  fetchPackaging,
  fetchPicking,
  fetchReceiving,
  monthBounds,
} from "./client";
import {
  aggregateInventory,
  aggregatePickingLike,
  aggregateReceiving,
  totalsFromDays,
  type DailyAgg,
  type InvAgg,
  type WaveAgg,
} from "./aggregate";
import type {
  DatasetCompare,
  MonthCompare,
  MonthTotals,
  SapDataSource,
} from "./types";

export type {
  DatasetCompare,
  DatasetKey,
  MonthCompare,
  MonthTotals,
  SapDataSource,
} from "./types";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function loadMappings(): Promise<EmployeeMapping[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("employee_system_mapping")
    .select("employee_id, external_employee_code, external_employee_name, employees(full_name)")
    .eq("system_name", "SAP")
    .eq("is_active", true);
  return (data ?? []) as unknown as EmployeeMapping[];
}

function dayDetailKey(d: DailyAgg): string {
  return [
    d.docDate,
    (d.userCode ?? "").trim().toLowerCase(),
    d.userName.trim().toLowerCase(),
    d.lineCount,
    d.waveCount,
    d.picklistCount,
  ].join("|");
}

function waveDetailKey(w: WaveAgg): string {
  return [w.periodMonth, w.waveKey, w.lineCount, w.picklistCount].join("|");
}

function invDetailKey(r: InvAgg): string {
  return r.compareKey;
}

function compareSets(
  a: string[],
  b: string[],
  labelA: string,
  labelB: string,
  max = 20
): string[] {
  const setA = new Set(a);
  const setB = new Set(b);
  const diffs: string[] = [];
  for (const k of a) {
    if (!setB.has(k)) {
      diffs.push(`Seul dans ${labelA}: ${k}`);
      if (diffs.length >= max) return diffs;
    }
  }
  for (const k of b) {
    if (!setA.has(k)) {
      diffs.push(`Seul dans ${labelB}: ${k}`);
      if (diffs.length >= max) return diffs;
    }
  }
  return diffs;
}

async function supabasePickingMonth(ym: string) {
  const supabase = getSupabase();
  const sapCols =
    "external_key, external_user_code, external_user_name, doc_date, period_month, line_count, wave_count, picklist_count";
  const [{ data: days }, { data: waves }] = await Promise.all([
    fetchAllRows<{
      external_key: string;
      external_user_code: string | null;
      external_user_name: string;
      doc_date: string;
      period_month: string;
      line_count: number;
      wave_count: number;
      picklist_count: number;
    }>((from, to) =>
      supabase
        .from("picking_daily_counts")
        .select(sapCols)
        .eq("period_month", ym)
        .range(from, to)
    ),
    fetchAllRows<{
      wave_key: string;
      period_month: string;
      doc_date: string;
      line_count: number;
      picklist_count: number;
    }>((from, to) =>
      supabase
        .from("picking_wave_stats")
        .select("wave_key, period_month, doc_date, line_count, picklist_count")
        .eq("period_month", ym)
        .range(from, to)
    ),
  ]);

  const dayAggs: DailyAgg[] = days.map((d) => ({
    externalKey: d.external_key,
    userCode: d.external_user_code,
    userName: d.external_user_name,
    employeeId: null,
    docDate: d.doc_date,
    periodMonth: d.period_month,
    lineCount: d.line_count,
    waveCount: d.wave_count,
    picklistCount: d.picklist_count,
  }));
  const waveAggs: WaveAgg[] = waves.map((w) => ({
    externalKey: `${w.period_month}::${w.wave_key}`,
    waveKey: w.wave_key,
    periodMonth: w.period_month,
    docDate: w.doc_date,
    lineCount: w.line_count,
    picklistCount: w.picklist_count,
  }));
  return { days: dayAggs, waves: waveAggs };
}

async function supabasePackagingMonth(ym: string) {
  const supabase = getSupabase();
  const { data } = await fetchAllRows<{
    external_key: string;
    external_user_code: string | null;
    external_user_name: string;
    doc_date: string;
    period_month: string;
    line_count: number;
    wave_count: number;
    picklist_count: number;
  }>((from, to) =>
    supabase
      .from("packaging_daily_counts")
      .select(
        "external_key, external_user_code, external_user_name, doc_date, period_month, line_count, wave_count, picklist_count"
      )
      .eq("period_month", ym)
      .range(from, to)
  );
  return data.map((d) => ({
    externalKey: d.external_key,
    userCode: d.external_user_code,
    userName: d.external_user_name,
    employeeId: null as string | null,
    docDate: d.doc_date,
    periodMonth: d.period_month,
    lineCount: d.line_count,
    waveCount: d.wave_count,
    picklistCount: d.picklist_count,
  }));
}

async function supabaseReceivingMonth(ym: string) {
  const supabase = getSupabase();
  const { data } = await fetchAllRows<{
    external_key: string;
    external_user_name: string;
    doc_date: string;
    period_month: string;
    line_count: number;
  }>((from, to) =>
    supabase
      .from("receiving_daily_counts")
      .select("external_key, external_user_name, doc_date, period_month, line_count")
      .eq("period_month", ym)
      .range(from, to)
  );
  return data.map((d) => ({
    externalKey: d.external_key,
    userCode: null as string | null,
    userName: d.external_user_name,
    employeeId: null as string | null,
    docDate: d.doc_date,
    periodMonth: d.period_month,
    lineCount: d.line_count,
    waveCount: 0,
    picklistCount: 0,
  }));
}

async function supabaseInventoryMonth(ym: string) {
  const supabase = getSupabase();
  const { data } = await fetchAllRows<{
    external_id: string;
    external_user_name: string;
    count_date: string;
    period_month: string;
    item_code: string | null;
    location: string | null;
    has_discrepancy: boolean;
  }>((from, to) =>
    supabase
      .from("inventory_count_lines")
      .select(
        "external_id, external_user_name, count_date, period_month, item_code, location, has_discrepancy"
      )
      .eq("period_month", ym)
      .range(from, to)
  );
  return data.map((r) => {
    const compareKey = [
      r.count_date,
      r.external_user_name.trim().toLowerCase(),
      (r.item_code ?? "").toLowerCase(),
      (r.location ?? "").toLowerCase(),
      r.has_discrepancy ? "1" : "0",
    ].join("|");
    return {
      externalId: r.external_id,
      userName: r.external_user_name,
      employeeId: null as string | null,
      countDate: r.count_date,
      periodMonth: r.period_month,
      itemCode: r.item_code,
      location: r.location,
      hasDiscrepancy: r.has_discrepancy,
      compareKey,
    };
  });
}

function totalsEqual(a: MonthTotals, b: MonthTotals): boolean {
  return (
    a.lineCount === b.lineCount &&
    a.waveCount === b.waveCount &&
    a.picklistCount === b.picklistCount &&
    a.dayRows === b.dayRows &&
    (a.discrepancyCount ?? 0) === (b.discrepancyCount ?? 0)
  );
}

export async function listImportedMonths(): Promise<string[]> {
  const supabase = getSupabase();
  const tables = [
    "picking_daily_counts",
    "packaging_daily_counts",
    "receiving_daily_counts",
    "inventory_count_lines",
  ] as const;
  const months = new Set<string>();
  for (const table of tables) {
    const { data } = await fetchAllRows<{ period_month: string }>((from, to) =>
      supabase
        .from(table)
        .select("period_month")
        .order("period_month", { ascending: false })
        .range(from, to)
    );
    for (const r of data) months.add(r.period_month);
  }
  return [...months].sort().reverse();
}

export async function compareMonth(ym: string): Promise<MonthCompare> {
  const mappings = await loadMappings();
  const { start, end } = monthBounds(ym);
  const datasets: DatasetCompare[] = [];

  // Picking
  {
    const [sb, raw] = await Promise.all([
      supabasePickingMonth(ym),
      fetchPicking(start, end),
    ]);
    const wrap = aggregatePickingLike(raw, mappings);
    const supabaseT = totalsFromDays(sb.days, sb.waves);
    const wrapperT = totalsFromDays(wrap.days, wrap.waves);
    const dayDiffs = compareSets(
      sb.days.map(dayDetailKey),
      wrap.days.map(dayDetailKey),
      "Supabase",
      "Wrapper"
    );
    const waveDiffs = compareSets(
      sb.waves.map(waveDetailKey),
      wrap.waves.map(waveDetailKey),
      "Supabase",
      "Wrapper"
    );
    const detailDiffs = [...dayDiffs, ...waveDiffs].slice(0, 25);
    datasets.push({
      dataset: "picking",
      supabase: supabaseT,
      wrapper: wrapperT,
      totalsMatch: totalsEqual(supabaseT, wrapperT),
      detailMatch: detailDiffs.length === 0,
      detailDiffs,
    });
  }

  // Packaging
  {
    const [sbDays, raw] = await Promise.all([
      supabasePackagingMonth(ym),
      fetchPackaging(start, end),
    ]);
    const wrap = aggregatePickingLike(raw, mappings);
    const supabaseT = totalsFromDays(sbDays);
    const wrapperT = totalsFromDays(wrap.days);
    const detailDiffs = compareSets(
      sbDays.map(dayDetailKey),
      wrap.days.map(dayDetailKey),
      "Supabase",
      "Wrapper"
    );
    datasets.push({
      dataset: "packaging",
      supabase: supabaseT,
      wrapper: wrapperT,
      totalsMatch: totalsEqual(supabaseT, wrapperT),
      detailMatch: detailDiffs.length === 0,
      detailDiffs,
    });
  }

  // Receiving
  {
    const [sbDays, raw] = await Promise.all([
      supabaseReceivingMonth(ym),
      fetchReceiving(start, end),
    ]);
    const wrapDays = aggregateReceiving(raw, mappings);
    const supabaseT = totalsFromDays(sbDays);
    const wrapperT = totalsFromDays(wrapDays);
    const detailDiffs = compareSets(
      sbDays.map(dayDetailKey),
      wrapDays.map(dayDetailKey),
      "Supabase",
      "Wrapper"
    );
    datasets.push({
      dataset: "receiving",
      supabase: supabaseT,
      wrapper: wrapperT,
      totalsMatch: totalsEqual(supabaseT, wrapperT),
      detailMatch: detailDiffs.length === 0,
      detailDiffs,
    });
  }

  // Inventory
  {
    const [sbRows, raw] = await Promise.all([
      supabaseInventoryMonth(ym),
      fetchInventory(start, end),
    ]);
    const wrapRows = aggregateInventory(raw, mappings);
    const supabaseT: MonthTotals = {
      lineCount: sbRows.length,
      waveCount: 0,
      picklistCount: 0,
      dayRows: sbRows.length,
      discrepancyCount: sbRows.filter((r) => r.hasDiscrepancy).length,
    };
    const wrapperT: MonthTotals = {
      lineCount: wrapRows.length,
      waveCount: 0,
      picklistCount: 0,
      dayRows: wrapRows.length,
      discrepancyCount: wrapRows.filter((r) => r.hasDiscrepancy).length,
    };
    const detailDiffs = compareSets(
      sbRows.map(invDetailKey),
      wrapRows.map(invDetailKey),
      "Supabase",
      "Wrapper"
    );
    datasets.push({
      dataset: "inventory",
      supabase: supabaseT,
      wrapper: wrapperT,
      totalsMatch: totalsEqual(supabaseT, wrapperT),
      detailMatch: detailDiffs.length === 0,
      detailDiffs,
    });
  }

  return {
    month: ym,
    datasets,
    allMatch: datasets.every((d) => d.totalsMatch && d.detailMatch),
  };
}

export async function getSapDataSource(): Promise<SapDataSource> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "sap_data_source")
    .maybeSingle();
  return data?.value === "wrapper" ? "wrapper" : "supabase";
}

export async function setSapDataSource(
  source: SapDataSource
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("app_settings").upsert({
    key: "sap_data_source",
    value: source,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
