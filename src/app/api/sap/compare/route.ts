import { NextRequest, NextResponse } from "next/server";
import {
  compareMonth,
  listImportedMonths,
} from "@/lib/sap/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month");
    if (!month) {
      const months = await listImportedMonths();
      return NextResponse.json({ months });
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Mois invalide (YYYY-MM)" }, { status: 400 });
    }
    const result = await compareMonth(month);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur comparaison";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
