import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Vérifie que l'appelant est un admin dans la table users */
async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("email", user.email)
    .maybeSingle();

  if (profile?.role !== "ADMIN") return null;
  return user;
}

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// Retourne les utilisateurs Supabase Auth + leur statut dans la table users
export async function GET() {
  const caller = await requireAdmin();
  if (!caller) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Tous les comptes Auth
  const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Tous les utilisateurs approuvés dans la table users
  const { data: approvedUsers, error: dbError } = await admin
    .from("users")
    .select("email, role, createdAt");
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const approvedMap = new Map(
    (approvedUsers ?? []).map((u: { email: string; role: string; createdAt: string }) => [u.email, u])
  );

  const users = authData.users.map((u) => {
    const approved = approvedMap.get(u.email ?? "");
    return {
      id: u.id,
      email: u.email ?? "",
      name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
      role: approved?.role ?? null,           // null = en attente
      approved: !!approved,
      last_sign_in: u.last_sign_in_at ?? null,
      created_at: u.created_at,
    };
  });

  return NextResponse.json({ users });
}

// ─── PATCH /api/admin/users ───────────────────────────────────────────────────
// Approuve un utilisateur ou change son rôle
export async function PATCH(req: NextRequest) {
  const caller = await requireAdmin();
  if (!caller) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const body = await req.json() as { email: string; role: string };
  const { email, role } = body;

  if (!email || !["ADMIN", "CONSULTATION"].includes(role)) {
    return NextResponse.json({ error: "email ou rôle invalide" }, { status: 400 });
  }

  // Empêcher l'admin de se retirer ses propres droits
  if (email === caller.email && role !== "ADMIN") {
    return NextResponse.json(
      { error: "Vous ne pouvez pas retirer vos propres droits admin." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Upsert dans la table users (crée ou met à jour)
  const { error } = await admin
    .from("users")
    .upsert(
      { email, role, updatedAt: new Date().toISOString() },
      { onConflict: "email" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ─── DELETE /api/admin/users ──────────────────────────────────────────────────
// Révoque l'accès d'un utilisateur
export async function DELETE(req: NextRequest) {
  const caller = await requireAdmin();
  if (!caller) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const body = await req.json() as { email: string };
  const { email } = body;

  if (!email) {
    return NextResponse.json({ error: "email manquant" }, { status: 400 });
  }

  if (email === caller.email) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas révoquer votre propre accès." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("users").delete().eq("email", email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
