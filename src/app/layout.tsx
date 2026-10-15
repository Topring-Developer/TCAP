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

  // Le rôle est stocké dans app_metadata (modifiable uniquement par l'admin Supabase)
  const role = (user?.app_metadata?.role ?? "user") as "admin" | "user";
  const userEmail = user?.email ?? null;

  return (
    <html lang="fr">
      <body className={`${user ? "flex h-screen overflow-hidden" : ""} bg-gray-50`}>
        {user && <Sidebar role={role} userEmail={userEmail} />}
        <main className={user ? "flex-1 overflow-y-auto" : "min-h-screen"}>
          {children}
        </main>
      </body>
    </html>
  );
}
