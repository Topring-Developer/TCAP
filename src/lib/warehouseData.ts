import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { PickingDailyRow, PickingWaveRow, S8PickingLog } from "@/lib/picking";
import type { PackagingDailyRow } from "@/lib/packaging";
import type { S8Log } from "@/lib/warehouse";
import { fetchSapDataSource, fetchSapKpiMonth } from "@/lib/sap/source";

const SAP_COLS =
  "id, employee_id, external_user_code, external_user_name, doc_date, period_month, line_count, wave_count, picklist_count";

const WAVE_COLS = "id, wave_key, period_month, doc_date, line_count, picklist_count";

export function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

type Client = ReturnType<typeof import("@/lib/supabase/client").createClient>;

export async function fetchPickingWaveStats(
  supabase: Client,
  periodMonth: string
): Promise<PickingWaveRow[]> {
  const source = await fetchSapDataSource();
  if (source === "wrapper") {
    const json = (await fetchSapKpiMonth("picking", periodMonth)) as {
      waves: PickingWaveRow[];
    };
    return json.waves ?? [];
  }
  const { data } = await fetchAllRows<PickingWaveRow>((from, to) =>
    supabase.from("picking_wave_stats").select(WAVE_COLS).eq("period_month", periodMonth).range(from, to)
  );
  return data;
}

export async function fetchPickingWaveStatsFrom(
  supabase: Client,
  fromMonth: string
): Promise<PickingWaveRow[]> {
  const source = await fetchSapDataSource();
  if (source === "wrapper") {
    const months: string[] = [];
    const [y, m] = fromMonth.split("-").map(Number);
    const now = new Date();
    let cy = y!;
    let cm = m!;
    while (
      cy < now.getFullYear() ||
      (cy === now.getFullYear() && cm <= now.getMonth() + 1)
    ) {
      months.push(`${cy}-${String(cm).padStart(2, "0")}`);
      cm += 1;
      if (cm > 12) {
        cm = 1;
        cy += 1;
      }
    }
    const all = await Promise.all(
      months.map(async (ym) => {
        const json = (await fetchSapKpiMonth("picking", ym)) as {
          waves: PickingWaveRow[];
        };
        return json.waves ?? [];
      })
    );
    return all.flat();
  }
  const { data } = await fetchAllRows<PickingWaveRow>((from, to) =>
    supabase.from("picking_wave_stats").select(WAVE_COLS).gte("period_month", fromMonth).range(from, to)
  );
  return data;
}

async function fetchS8ForMonth(
  supabase: Client,
  ym: string
): Promise<{ pickLogs: S8Log[]; expLogs: S8Log[] }> {
  const { start, end } = monthBounds(ym);
  const [{ data: pickTasks }, { data: expTasks }] = await Promise.all([
    supabase.from("task_mapping").select("id").eq("kpi_department", "Picking").eq("include_in_kpi", true),
    supabase.from("task_mapping").select("id").eq("kpi_department", "Expédition").eq("include_in_kpi", true),
  ]);
  const pickTaskIds = (pickTasks ?? []).map((t) => t.id);
  const expTaskIds = (expTasks ?? []).map((t) => t.id);
  const emptyS8 = Promise.resolve({ data: [] as S8PickingLog[], error: null });

  const [pickS8, expS8] = await Promise.all([
    pickTaskIds.length > 0
      ? fetchAllRows<S8PickingLog>((from, to) =>
          supabase
            .from("s8_time_logs")
            .select("employee_id, log_date, duration_minutes")
            .in("task_mapping_id", pickTaskIds)
            .gte("log_date", start)
            .lte("log_date", end)
            .range(from, to)
        )
      : emptyS8,
    expTaskIds.length > 0
      ? fetchAllRows<S8PickingLog>((from, to) =>
          supabase
            .from("s8_time_logs")
            .select("employee_id, log_date, duration_minutes")
            .in("task_mapping_id", expTaskIds)
            .gte("log_date", start)
            .lte("log_date", end)
            .range(from, to)
        )
      : emptyS8,
  ]);

  return {
    pickLogs: pickS8.data.filter((l) => l.employee_id),
    expLogs: expS8.data.filter((l) => l.employee_id),
  };
}

export async function fetchWarehouseMonth(
  supabase: Client,
  ym: string
): Promise<{
  pickRows: PickingDailyRow[];
  packRows: PackagingDailyRow[];
  pickLogs: S8Log[];
  expLogs: S8Log[];
  waveRows: PickingWaveRow[];
}> {
  const source = await fetchSapDataSource();
  const s8 = fetchS8ForMonth(supabase, ym);

  if (source === "wrapper") {
    const [pickJson, packJson, logs] = await Promise.all([
      fetchSapKpiMonth("picking", ym) as Promise<{
        days: PickingDailyRow[];
        waves: PickingWaveRow[];
      }>,
      fetchSapKpiMonth("packaging", ym) as Promise<{ days: PackagingDailyRow[] }>,
      s8,
    ]);
    return {
      pickRows: pickJson.days ?? [],
      packRows: packJson.days ?? [],
      waveRows: pickJson.waves ?? [],
      pickLogs: logs.pickLogs,
      expLogs: logs.expLogs,
    };
  }

  const [pickSap, packSap, logs, waveSap] = await Promise.all([
    fetchAllRows<PickingDailyRow>((from, to) =>
      supabase.from("picking_daily_counts").select(SAP_COLS).eq("period_month", ym).range(from, to)
    ),
    fetchAllRows<PackagingDailyRow>((from, to) =>
      supabase.from("packaging_daily_counts").select(SAP_COLS).eq("period_month", ym).range(from, to)
    ),
    s8,
    fetchPickingWaveStats(supabase, ym),
  ]);

  return {
    pickRows: pickSap.data,
    packRows: packSap.data,
    pickLogs: logs.pickLogs,
    expLogs: logs.expLogs,
    waveRows: waveSap,
  };
}
