import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Vérifie que le demandeur est un admin avant toute action */
async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") return null;
  return user;
}

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// Liste tous les utilisateurs avec leur rôle
export async function GET() {
  const caller = await requireAdmin();
  if (!caller) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = data.users.map((u) => ({
    id: u.id,
    email: u.email ?? "",
    name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
    role: (u.app_metadata?.role ?? "user") as "admin" | "user",
    last_sign_in: u.last_sign_in_at ?? null,
    created_at: u.created_at,
  }));

  return NextResponse.json({ users });
}

// ─── PATCH /api/admin/users ───────────────────────────────────────────────────
// Met à jour le rôle d'un utilisateur
export async function PATCH(req: NextRequest) {
  const caller = await requireAdmin();
  if (!caller) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const body = await req.json() as { userId: string; role: string };
  const { userId, role } = body;

  if (!userId || !["admin", "user"].includes(role)) {
    return NextResponse.json({ error: "userId ou rôle invalide" }, { status: 400 });
  }

  // Empêcher l'admin de se retirer lui-même ses droits
  if (userId === caller.id && role !== "admin") {
    return NextResponse.json(
      { error: "Vous ne pouvez pas retirer vos propres droits admin." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
