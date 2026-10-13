import { NextRequest, NextResponse } from "next/server";
import {
  getSapDataSource,
  setSapDataSource,
  type SapDataSource,
} from "@/lib/sap/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const source = await getSapDataSource();
    return NextResponse.json({ source });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur lecture source";
    // Table absente → défaut supabase
    if (message.includes("app_settings") || message.includes("schema cache")) {
      return NextResponse.json({ source: "supabase" as SapDataSource });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { source?: string };
    if (body.source !== "supabase" && body.source !== "wrapper") {
      return NextResponse.json(
        { error: "source doit être supabase ou wrapper" },
        { status: 400 }
      );
    }
    await setSapDataSource(body.source);
    return NextResponse.json({ source: body.source });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur écriture source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
