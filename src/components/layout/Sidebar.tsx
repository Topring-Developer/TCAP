"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  MinusCircle,
  ArrowLeftRight,
  BarChart3,
  TrendingUp,
  Building2,
  UserSquare2,
  ListChecks,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
};

type NavSection = {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    id: "capacity",
    label: "Capacité",
    icon: CalendarDays,
    items: [
      { href: "/dashboard", label: "Dashboard capacité", icon: LayoutDashboard },
      { href: "/capacity", label: "Vue semaine", icon: CalendarDays },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    icon: TrendingUp,
    items: [
      { href: "/kpi", label: "Dashboard KPI", icon: BarChart3 },
      { href: "/kpi/department", label: "Par département", icon: Building2 },
    ],
  },
  {
    id: "management",
    label: "Gestion",
    icon: Users,
    items: [
      { href: "/employees", label: "Employés & Horaires", icon: Users },
      { href: "/exclusions", label: "Exclusions", icon: MinusCircle },
      { href: "/adjustments", label: "Ajustements", icon: ArrowLeftRight },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    icon: ShieldCheck,
    items: [
      { href: "/admin/mapping-employees", label: "Mapping employés", icon: UserSquare2 },
      { href: "/admin/mapping-tasks", label: "Mapping tâches", icon: ListChecks },
      { href: "/admin/validation", label: "Validation données", icon: ShieldCheck },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function isActive(href: string) {
    return pathname === href || (href !== "/" && pathname.startsWith(href));
  }

  function isSectionActive(section: NavSection) {
    return section.items.some((item) => isActive(item.href));
  }

  function toggleSection(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Section ouverte si un item est actif OU si pas encore fermée manuellement
  function isSectionOpen(section: NavSection) {
    if (collapsed[section.id] !== undefined) return !collapsed[section.id];
    return isSectionActive(section);
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-slate-900 text-slate-100 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">TOPRINGS</p>
        <h1 className="text-lg font-bold text-white mt-0.5">TCAP</h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_SECTIONS.map((section) => {
          const open = isSectionOpen(section);
          const SectionIcon = section.icon;
          return (
            <div key={section.id}>
              {/* En-tête de section */}
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <SectionIcon className="w-3.5 h-3.5" />
                  {section.label}
                </div>
                {open
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />}
              </button>

              {/* Items */}
              {open && (
                <div className="mt-0.5 space-y-0.5 mb-2">
                  {section.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ml-2",
                          active
                            ? "bg-blue-600 text-white"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-slate-700">
        <p className="text-xs text-slate-500">v1.1 · TOPRINGS</p>
      </div>
    </aside>
  );
}
