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
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/capacity", label: "Vue semaine", icon: CalendarDays },
  { href: "/employees", label: "Employés", icon: Users },
  { href: "/schedules", label: "Horaires", icon: BarChart3 },
  { href: "/exclusions", label: "Exclusions", icon: MinusCircle },
  { href: "/adjustments", label: "Ajustements", icon: ArrowLeftRight },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 flex-shrink-0 bg-slate-900 text-slate-100 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Entrepôt</p>
        <h1 className="text-lg font-bold text-white mt-0.5">Capacité</h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-slate-700">
        <p className="text-xs text-slate-500">v1.0 · TOPRINGS</p>
      </div>
    </aside>
  );
}
