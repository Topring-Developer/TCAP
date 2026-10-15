"use client";

import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function PendingPage() {
  const supabase = createClient();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">

        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">
          TOPRINGS · TCAP
        </p>
        <h1 className="text-2xl font-bold text-white mb-3">
          Accès en attente
        </h1>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          Votre compte Microsoft a bien été reconnu, mais votre accès à TCAP
          n&apos;a pas encore été approuvé par un administrateur.
          <br /><br />
          Contactez votre responsable pour qu&apos;il vous assigne un rôle dans la
          section <strong className="text-zinc-200">Configuration → Gestion des accès</strong>.
        </p>

        <button
          onClick={handleLogout}
          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
