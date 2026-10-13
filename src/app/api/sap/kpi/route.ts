import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { EmployeeMapping } from "@/lib/inventory";
import {
  fetchInventory,
  fetchPackaging,
  fetchPicking,
  fetchReceiving,
  monthBounds,
} from "@/lib/sap/client";
import {
  aggregateInventory,
  aggregatePickingLike,
  aggregateReceiving,
  toInventoryLines,
  toPackagingDailyRows,
  toPickingDailyRows,
  toReceivingDailyRows,
  toWaveRows,
} from "@/lib/sap/aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadMappings(): Promise<EmployeeMapping[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from("employee_system_mapping")
    .select(
      "employee_id, external_employee_code, external_employee_name, employees(full_name)"
    )
    .eq("system_name", "SAP")
    .eq("is_active", true);
  return (data ?? []) as unknown as EmployeeMapping[];
}

export async function GET(req: NextRequest) {
  try {
    const dataset = req.nextUrl.searchParams.get("dataset");
    const month = req.nextUrl.searchParams.get("month");
    if (!dataset || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: "dataset et month (YYYY-MM) requis" },
        { status: 400 }
      );
    }
    const { start, end } = monthBounds(month);
    const mappings = await loadMappings();

    if (dataset === "picking") {
      const raw = await fetchPicking(start, end);
      const { days, waves } = aggregatePickingLike(raw, mappings);
      return NextResponse.json({
        days: toPickingDailyRows(days),
        waves: toWaveRows(waves),
      });
    }
    if (dataset === "packaging") {
      const raw = await fetchPackaging(start, end);
      const { days } = aggregatePickingLike(raw, mappings);
      return NextResponse.json({ days: toPackagingDailyRows(days) });
    }
    if (dataset === "receiving") {
      const raw = await fetchReceiving(start, end);
      const days = aggregateReceiving(raw, mappings);
      return NextResponse.json({ days: toReceivingDailyRows(days) });
    }
    if (dataset === "inventory") {
      const raw = await fetchInventory(start, end);
      const rows = aggregateInventory(raw, mappings);
      return NextResponse.json({ lines: toInventoryLines(rows) });
    }

    return NextResponse.json({ error: "dataset inconnu" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur lecture SAP";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
