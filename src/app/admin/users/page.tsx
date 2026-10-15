"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw, ShieldCheck, Eye, UserCircle2,
  Clock, CheckCircle2, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "CONSULTATION" | null;
  approved: boolean;
  last_sign_in: string | null;
  created_at: string;
};

const ROLE_CONFIG = {
  ADMIN: {
    label: "Admin",
    description: "Accès complet",
    icon: ShieldCheck,
    badge: "bg-primary/10 text-primary border-primary/20",
  },
  CONSULTATION: {
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
  const [working, setWorking] = useState<string | null>(null); // email en cours

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

  async function handleApprove(email: string, role: "ADMIN" | "CONSULTATION") {
    setWorking(email);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) =>
        prev.map((u) => u.email === email ? { ...u, role, approved: true } : u)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setWorking(null);
    }
  }

  async function handleRevoke(email: string) {
    if (!confirm(`Révoquer l'accès de ${email} ?`)) return;
    setWorking(email);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) =>
        prev.map((u) => u.email === email ? { ...u, role: null, approved: false } : u)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setWorking(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("fr-CA", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  }

  const pending = users.filter((u) => !u.approved);
  const approved = users.filter((u) => u.approved);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Gestion des accès"
        subtitle="Approuver les nouvelles connexions et gérer les rôles"
        actions={
          <Button variant="secondary" onClick={loadUsers} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Actualiser
          </Button>
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-400 gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      ) : (
        <div className="space-y-8">

          {/* ── En attente ── */}
          {pending.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-zinc-700">
                  En attente d&apos;approbation
                  <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold">
                    {pending.length}
                  </span>
                </h2>
              </div>
              <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-amber-50 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Utilisateur</th>
                      <th className="text-left px-4 py-3">Connexion</th>
                      <th className="text-right px-4 py-3">Donner accès</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pending.map((u) => {
                      const isWorking = working === u.email;
                      return (
                        <tr key={u.id} className="hover:bg-zinc-50/50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                                <UserCircle2 className="w-5 h-5 text-amber-400" />
                              </div>
                              <div>
                                {u.name && <p className="font-medium text-zinc-900">{u.name}</p>}
                                <p className="text-zinc-500 text-xs">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                            {formatDate(u.last_sign_in)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              {(["CONSULTATION", "ADMIN"] as const).map((r) => (
                                <button
                                  key={r}
                                  onClick={() => handleApprove(u.email, r)}
                                  disabled={isWorking}
                                  className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                    r === "ADMIN"
                                      ? "border-primary/30 text-primary hover:bg-primary/5"
                                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
                                    isWorking && "opacity-50 cursor-wait"
                                  )}
                                >
                                  {isWorking && <RefreshCw className="w-3 h-3 animate-spin inline mr-1" />}
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
              </div>
            </section>
          )}

          {/* ── Utilisateurs actifs ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <h2 className="text-sm font-semibold text-zinc-700">
                Utilisateurs actifs
                <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-bold">
                  {approved.length}
                </span>
              </h2>
            </div>
            <div className="bg-white border rounded-xl overflow-hidden">
              {approved.length === 0 ? (
                <div className="py-10 text-center text-zinc-400 text-sm">
                  Aucun utilisateur approuvé.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-zinc-50 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Utilisateur</th>
                      <th className="text-left px-4 py-3">Dernière connexion</th>
                      <th className="text-left px-4 py-3">Rôle</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {approved.map((u) => {
                      const role = u.role!;
                      const cfg = ROLE_CONFIG[role];
                      const Icon = cfg.icon;
                      const isWorking = working === u.email;

                      return (
                        <tr key={u.id} className="hover:bg-zinc-50/50">
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
                          <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                            {formatDate(u.last_sign_in)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                              cfg.badge
                            )}>
                              <Icon className="w-3 h-3" />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              {/* Changer de rôle */}
                              {(["CONSULTATION", "ADMIN"] as const)
                                .filter((r) => r !== role)
                                .map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => handleApprove(u.email, r)}
                                    disabled={isWorking}
                                    className={cn(
                                      "px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-all",
                                      isWorking && "opacity-50 cursor-wait"
                                    )}
                                  >
                                    → {ROLE_CONFIG[r].label}
                                  </button>
                                ))}
                              {/* Révoquer */}
                              <button
                                onClick={() => handleRevoke(u.email)}
                                disabled={isWorking}
                                className={cn(
                                  "p-1.5 rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all",
                                  isWorking && "opacity-50 cursor-wait"
                                )}
                                title="Révoquer l'accès"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        Les changements de rôle sont actifs dès la prochaine navigation de l&apos;utilisateur.
      </p>
    </div>
  );
}
