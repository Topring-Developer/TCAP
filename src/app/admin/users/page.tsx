"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Eye, UserCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
  last_sign_in: string | null;
  created_at: string;
};

const ROLE_CONFIG = {
  admin: {
    label: "Admin",
    description: "Accès complet",
    icon: ShieldCheck,
    badge: "bg-primary/10 text-primary border-primary/20",
  },
  user: {
    label: "Consultation",
    description: "Capacité, Performance, Gestion",
    icon: Eye,
    badge: "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
};

export default function ManageUsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null); // userId en cours

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleRoleChange(userId: string, newRole: "admin" | "user") {
    setUpdating(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setUpdating(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("fr-CA", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Gestion des accès"
        subtitle="Assigner les rôles Admin ou Consultation aux utilisateurs"
        actions={
          <Button variant="secondary" onClick={loadUsers} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Actualiser
          </Button>
        }
      />

      {/* Légende des rôles */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(["admin", "user"] as const).map((r) => {
          const cfg = ROLE_CONFIG[r];
          const Icon = cfg.icon;
          return (
            <div key={r} className="border rounded-xl p-4 bg-white flex items-start gap-3">
              <div className={cn("p-2 rounded-lg border", cfg.badge)}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-sm">{cfg.label}</p>
                <p className="text-xs text-zinc-500">{cfg.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tableau utilisateurs */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400 gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Chargement…</span>
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 text-sm">
            Aucun utilisateur trouvé.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3">Utilisateur</th>
                <th className="text-left px-4 py-3">Dernière connexion</th>
                <th className="text-left px-4 py-3">Rôle actuel</th>
                <th className="text-right px-4 py-3">Modifier</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => {
                const cfg = ROLE_CONFIG[u.role];
                const Icon = cfg.icon;
                const isUpdating = updating === u.id;

                return (
                  <tr key={u.id} className="hover:bg-zinc-50/50 transition-colors">
                    {/* Utilisateur */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center shrink-0">
                          <UserCircle2 className="w-5 h-5 text-zinc-400" />
                        </div>
                        <div>
                          {u.name && <p className="font-medium text-zinc-900">{u.name}</p>}
                          <p className="text-zinc-500 text-xs">{u.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Dernière connexion */}
                    <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                      {formatDate(u.last_sign_in)}
                    </td>

                    {/* Rôle actuel */}
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                        cfg.badge
                      )}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </td>

                    {/* Boutons changer rôle */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {(["admin", "user"] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => handleRoleChange(u.id, r)}
                            disabled={u.role === r || isUpdating}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                              u.role === r
                                ? "opacity-30 cursor-default " + ROLE_CONFIG[r].badge
                                : "hover:shadow-sm cursor-pointer border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50",
                              isUpdating && "opacity-50 cursor-wait"
                            )}
                          >
                            {isUpdating && u.role !== r ? (
                              <RefreshCw className="w-3 h-3 animate-spin inline mr-1" />
                            ) : null}
                            {ROLE_CONFIG[r].label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Les changements de rôle sont actifs dès la prochaine connexion de l&apos;utilisateur.
      </p>
    </div>
  );
}
