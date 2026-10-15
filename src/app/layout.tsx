import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Capacité Équipe",
  description: "Gestion de la capacité quotidienne des employés",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Rôle lu depuis la table users (source de vérité)
  let role: "ADMIN" | "CONSULTATION" | null = null;
  if (user?.email) {
    const { data } = await supabase
      .from("users")
      .select("role")
      .eq("email", user.email)
      .maybeSingle();
    role = (data?.role ?? null) as "ADMIN" | "CONSULTATION" | null;
  }

  const showSidebar = !!user && !!role;

  return (
    <html lang="fr">
      <body className={`${showSidebar ? "flex h-screen overflow-hidden" : ""} bg-gray-50`}>
        {showSidebar && (
          <Sidebar role={role!} userEmail={user?.email ?? null} />
        )}
        <main className={showSidebar ? "flex-1 overflow-y-auto" : "min-h-screen"}>
          {children}
        </main>
      </body>
    </html>
  );
}
