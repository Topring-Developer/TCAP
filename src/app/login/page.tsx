"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Laptop } from "lucide-react";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  async function handleMicrosoftLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email openid profile",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error("Erreur de connexion :", error.message);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1">
            TOPRINGS
          </p>
          <h1 className="text-3xl font-bold text-white">TCAP</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Gestion de la capacité &amp; performance
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">Connexion</h2>
          <p className="text-sm text-zinc-400 mb-6">
            Utilisez votre compte Microsoft Toprings pour accéder à l&apos;application.
          </p>

          <button
            onClick={handleMicrosoftLogin}
            className="w-full flex items-center justify-center gap-3 bg-[#2f2f2f] hover:bg-[#404040] border border-zinc-600 text-white font-medium rounded-lg px-4 py-3 transition-colors text-sm"
          >
            {/* Logo Microsoft SVG */}
            <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Se connecter avec Microsoft
          </button>
        </div>

        <p className="text-center text-xs text-zinc-600 mt-6">
          Accès réservé aux employés Toprings
        </p>
      </div>
    </div>
  );
}
