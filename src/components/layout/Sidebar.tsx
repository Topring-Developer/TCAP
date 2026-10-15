"use client";

import Link from "next/link";
import {
  Users,
  CalendarDays,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Settings,
  FolderInput,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type NavItem = {
  href: string;
  label: string;
};

type NavDivider = {
  kind: "divider";
  label: string;
};

type NavEntry =
  | ({ kind: "item" } & NavItem)
  | NavDivider;

type NavSection = {
  id: string;
  label: string;
  icon: React.ElementType;
  entries: NavEntry[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    id: "capacity",
    label: "Capacité",
    icon: CalendarDays,
    entries: [
      { kind: "item", href: "/dashboard", label: "Dashboard capacité" },
      { kind: "item", href: "/capacity",  label: "Vue semaine" },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    icon: TrendingUp,
    entries: [
      { kind: "item", href: "/kpi",            label: "Dashboard KPI" },
      { kind: "item", href: "/kpi/mois",       label: "Résumé du mois" },
      { kind: "item", href: "/kpi/warehouse",  label: "KPI Expédition" },
      { kind: "item", href: "/kpi/picking",    label: "KPI Picking" },
      { kind: "item", href: "/kpi/production", label: "KPI Production" },
      { kind: "item", href: "/kpi/production/employees", label: "Prod par employé" },
      { kind: "item", href: "/kpi/inventory",  label: "KPI Inventaire" },
      { kind: "item", href: "/kpi/receiving",  label: "KPI Réception" },
      { kind: "item", href: "/kpi/department", label: "Par département" },
    ],
  },
  {
    id: "management",
    label: "Gestion",
    icon: Users,
    entries: [
      { kind: "item", href: "/employees", label: "Employés & Horaires" },
      { kind: "item", href: "/events",    label: "Événements" },
    ],
  },
  {
    id: "imports",
    label: "Imports",
    icon: FolderInput,
    entries: [
      { kind: "divider", label: "SAP" },
      { kind: "item", href: "/admin/import/sap-control", label: "Contrôle SAP" },
      { kind: "item", href: "/admin/import/picking",    label: "Picking" },
      { kind: "item", href: "/admin/import/packaging",  label: "Emballage" },
      { kind: "item", href: "/admin/import/receiving",  label: "Réception" },
      { kind: "item", href: "/admin/import/inventory",  label: "Inventaire" },
      { kind: "item", href: "/admin/import/standards",  label: "Temps standard PROD" },
      { kind: "divider", label: "TWMS" },
      { kind: "item", href: "/admin/import/production", label: "Temps par BOM" },
      { kind: "item", href: "/admin/import/production-log", label: "Prod employé" },
      { kind: "item", href: "/admin/twms",   label: "Vérif. logs TWMS" },
      { kind: "item", href: "/admin/import", label: "Import S8" },
      { kind: "divider", label: "Suivi" },
      { kind: "item", href: "/admin/import-register", label: "Registre d'import" },
    ],
  },
  {
    id: "config",
    label: "Configuration",
    icon: Settings,
    entries: [
      { kind: "item", href: "/admin/users",              label: "Gestion des accès" },
      { kind: "item", href: "/admin/capacity-settings",  label: "Seuil d'effectif" },
      { kind: "item", href: "/admin/mapping-employees",  label: "Mapping employés" },
      { kind: "item", href: "/admin/mapping-tasks",      label: "Mapping tâches" },
      { kind: "item", href: "/admin/inventory-settings", label: "Objectif inventaire" },
      { kind: "item", href: "/admin/validation",         label: "Validation données" },
    ],
  },
];

/** Sections réservées aux administrateurs uniquement */
const ADMIN_SECTION_IDS = ["imports", "config"];

const STORAGE_KEY = "tcap-sidebar-collapsed";

export function Sidebar({ role, userEmail }: { role: "ADMIN" | "CONSULTATION"; userEmail: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const visibleSections = NAV_SECTIONS.filter(
    (s) => role === "ADMIN" || !ADMIN_SECTION_IDS.includes(s.id)
  );

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) setOpenId(null);
      return next;
    });
  }

  function toggleSection(id: string) {
    if (collapsed) {
      setCollapsed(false);
      try {
        localStorage.setItem(STORAGE_KEY, "0");
      } catch {
        /* ignore */
      }
      setOpenId(id);
      return;
    }
    setOpenId((prev) => (prev === id ? null : id));
  }

  return (
    <aside
      className={`flex-shrink-0 bg-zinc-950 text-zinc-100 flex flex-col border-r border-zinc-800 transition-[width] duration-200 ease-out ${
        collapsed ? "w-[68px]" : "w-60"
      } ${ready ? "" : "opacity-0"}`}
    >
      {/* Logo */}
      <div className={`border-b border-zinc-800 ${collapsed ? "px-2 py-4" : "px-5 py-5"}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary">TR</span>
            <span className="text-xs font-bold text-white">TCAP</span>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">TOPRINGS</p>
            <h1 className="text-base font-bold text-white mt-0.5">TCAP</h1>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-3 overflow-y-auto space-y-0.5 ${collapsed ? "px-1.5" : "px-2"}`}>
        {visibleSections.map((section) => {
          const open = openId === section.id;
          const SectionIcon = section.icon;

          return (
            <div key={section.id} className="mb-1">
              <button
                onClick={() => toggleSection(section.id)}
                title={collapsed ? section.label : undefined}
                className={`w-full flex items-center rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                  collapsed
                    ? "justify-center px-0 py-2.5"
                    : "justify-between px-3 py-2.5"
                } ${
                  open
                    ? "text-white bg-zinc-800/80"
                    : "text-zinc-300 hover:text-white hover:bg-zinc-800/60"
                }`}
              >
                <div className={`flex items-center ${collapsed ? "" : "gap-2.5"}`}>
                  <SectionIcon className="w-4 h-4 shrink-0" />
                  {!collapsed && <span>{section.label}</span>}
                </div>
                {!collapsed && (
                  <span className="text-zinc-400">
                    {open
                      ? <ChevronDown className="w-3.5 h-3.5" />
                      : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                )}
              </button>

              {!collapsed && open && (
                <div className="mt-1 ml-5 pl-3 border-l border-zinc-700 space-y-0.5">
                  {section.entries.map((entry, i) => {
                    if (entry.kind === "divider") {
                      return (
                        <div key={`div-${i}`} className="flex items-center gap-2 px-2 pt-2.5 pb-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                            {entry.label}
                          </span>
                          <div className="flex-1 h-px bg-zinc-700/80" />
                        </div>
                      );
                    }

                    return (
                      <Link
                        key={entry.href}
                        href={entry.href}
                        className="block px-2.5 py-2 rounded-md text-sm font-normal text-zinc-300 hover:text-white hover:bg-zinc-800/70 transition-all"
                      >
                        <span className="truncate">{entry.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={`border-t border-zinc-800 ${collapsed ? "p-1.5" : "px-3 py-3"}`}>
        {/* Infos utilisateur */}
        {!collapsed && userEmail && (
          <div className="mb-2 px-2">
            <p className="text-[10px] text-zinc-500 truncate">{userEmail}</p>
            <span className={`inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              role === "ADMIN"
                ? "bg-primary/20 text-primary"
                : "bg-zinc-700 text-zinc-300"
            }`}>
              {role === "ADMIN" ? "Admin" : "Consultation"}
            </span>
          </div>
        )}

        {/* Bouton déconnexion */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          title={collapsed ? "Se déconnecter" : undefined}
          className={`w-full flex items-center rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-all ${
            collapsed ? "justify-center py-2.5" : "justify-between px-2 py-2"
          }`}
        >
          {!collapsed && (
            <span className="text-xs font-medium">
              {loggingOut ? "Déconnexion…" : "Se déconnecter"}
            </span>
          )}
          <LogOut className="w-4 h-4 shrink-0" />
        </button>

        {/* Bouton collapse */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Ouvrir le menu" : "Ranger le menu"}
          className={`w-full flex items-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all mt-1 ${
            collapsed ? "justify-center py-2.5" : "justify-between px-2 py-2"
          }`}
        >
          {!collapsed && (
            <span className="text-[10px] text-zinc-500 font-medium">v1.1 · TOPRINGS</span>
          )}
          {collapsed
            ? <PanelLeftOpen className="w-4 h-4" />
            : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
