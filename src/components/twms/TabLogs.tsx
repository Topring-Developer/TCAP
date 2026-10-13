"use client";
import { useState } from "react";
import { AnalysisResult, AnomalyRecord, fmtMin } from "@/lib/twms";

interface Props { data: AnalysisResult; empFilter: string[] }

const DARK = { background: "#1e293b", border: "1px solid #334155" };

type FlatRow = {
  emp:      string;
  date:     string;
  time:     string;
  type:     string;
  detail:   string;
  duration: number;
  sev:      string;
};

const SEV_COLOR: Record<string, string> = {
  "Élevée": "#ef4444",
  "Moyenne": "#f59e0b",
  "Faible": "#94a3b8",
};

function matchFilter(type: string, filter: string) {
  if (filter === "Tous") return true;
  if (filter === "Pause") return type.toLowerCase().startsWith("pause");
  return type === filter;
}

function typeStyle(type: string) {
  if (type === "Trou non loggé")  return { color: "#f97316", bg: "#431407" };
  if (type === "Arrivée tardive") return { color: "#a78bfa", bg: "#2e1065" };
  if (type === "Départ anticipé") return { color: "#60a5fa", bg: "#1e3a5f" };
  if (type.toLowerCase().startsWith("pause")) return { color: "#34d399", bg: "#064e3b" };
  return { color: "#94a3b8", bg: "#1e293b" };
}

export default function TabLogs({ data, empFilter }: Props) {
  const [typeFilter, setTypeFilter] = useState<string>("Tous");
  const [sortCol,    setSortCol]    = useState<"date" | "emp" | "type" | "duration">("date");
  const [sortAsc,    setSortAsc]    = useState(true);
  const [page,       setPage]       = useState(0);
  const PAGE_SIZE = 50;

  const anoms: AnomalyRecord[] = data.anomalies.filter(a => {
    if (a.type === "Journée absente") return false;
    return empFilter.length ? empFilter.includes(a.emp_key) : true;
  });

  const flat: FlatRow[] = anoms.map(a => ({
    emp:      a.emp_key,
    date:     a.date,
    time:     a.time ?? "",
    type:     a.type,
    detail:   a.description,
    duration: a.duration_min,
    sev:      a.severity,
  }));

  const countTrous   = flat.filter(r => r.type === "Trou non loggé").length;
  const countTardif  = flat.filter(r => r.type === "Arrivée tardive").length;
  const countDepart  = flat.filter(r => r.type === "Départ anticipé").length;
  const countPauses  = flat.filter(r => r.type.toLowerCase().startsWith("pause")).length;
  const totalTrouMin = flat.filter(r => r.type === "Trou non loggé").reduce((s, r) => s + r.duration, 0);

  const filtered = flat
    .filter(r => matchFilter(r.type, typeFilter))
    .sort((a, b) => {
      let cmp = 0;
      if (sortCol === "date")     cmp = (a.date + a.time).localeCompare(b.date + b.time);
      if (sortCol === "emp")      cmp = a.emp.localeCompare(b.emp);
      if (sortCol === "type")     cmp = a.type.localeCompare(b.type);
      if (sortCol === "duration") cmp = a.duration - b.duration;
      return sortAsc ? cmp : -cmp;
    });

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
    setPage(0);
  }

  function setFilter(f: string) { setTypeFilter(f); setPage(0); }

  const Th = ({ col, label, cls = "" }: { col: typeof sortCol; label: string; cls?: string }) => (
    <th
      className={`py-3 px-3 text-left cursor-pointer select-none hover:text-white ${cls}`}
      onClick={() => toggleSort(col)}
    >
      {label} {sortCol === col ? (sortAsc ? "▲" : "▼") : ""}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-sm" style={{ background: "#0c2340", border: "1px solid #1d4ed8", color: "#93c5fd" }}>
        ℹ️ Un <strong>trou</strong> = période sans activité entre deux logs.
        Une <strong>anomalie</strong> = arrivée tardive, départ anticipé ou pause non conforme.
        Objectif = <strong>0 trou, 0 anomalie</strong>.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { key: "Trou non loggé",  label: "Trous",             value: countTrous,  sub: fmtMin(totalTrouMin) + " perdues", color: "#f97316" },
          { key: "Arrivée tardive", label: "Arrivées tardives",  value: countTardif, sub: "pointages en retard",             color: "#a78bfa" },
          { key: "Départ anticipé", label: "Départs anticipés",  value: countDepart, sub: "départs avant fin quart",         color: "#60a5fa" },
          { key: "Pause",           label: "Pauses",             value: countPauses, sub: "non conformes",                   color: "#34d399" },
        ].map(k => {
          const active = typeFilter === k.key || (k.key === "Pause" && typeFilter === "Pause");
          return (
            <button
              key={k.key}
              onClick={() => setFilter(active ? "Tous" : k.key)}
              className="rounded-xl p-4 text-left transition-all"
              style={{
                background: active ? "#0f172a" : "#1e293b",
                border: `2px solid ${active ? k.color : "#334155"}`,
              }}
            >
              <p className="text-xs mb-1" style={{ color: k.color }}>{k.label}</p>
              <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
              <p className="text-xs text-slate-500 mt-1">{k.sub}</p>
            </button>
          );
        })}
      </div>

      {typeFilter !== "Tous" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Filtre actif :</span>
          <span className="px-2 py-1 rounded text-xs font-semibold" style={{ background: typeStyle(typeFilter === "Pause" ? "pause" : typeFilter).bg, color: typeStyle(typeFilter === "Pause" ? "pause" : typeFilter).color }}>
            {typeFilter}
          </span>
          <button onClick={() => setFilter("Tous")} className="text-slate-500 hover:text-white text-xs underline">
            Tout afficher
          </button>
          <span className="text-slate-500 text-xs">({filtered.length} ligne{filtered.length > 1 ? "s" : ""})</span>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={DARK}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
              <Th col="emp"      label="Employé" />
              <Th col="date"     label="Date" />
              <th className="py-3 px-3 text-left text-slate-400 text-xs">Heure</th>
              <Th col="type"     label="Type" />
              <th className="py-3 px-3 text-left text-slate-400 text-xs">Détail</th>
              <Th col="duration" label="Durée" cls="text-right" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-green-400 text-sm">
                  ✓ Aucun problème dans cette catégorie.
                </td>
              </tr>
            )}
            {shown.map((r, i) => {
              const ts = typeStyle(r.type);
              return (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/20">
                  <td className="py-2 px-3 text-white font-medium whitespace-nowrap">{r.emp}</td>
                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{r.date}</td>
                  <td className="py-2 px-3 text-slate-300 font-mono whitespace-nowrap">{r.time || "—"}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: ts.bg, color: ts.color }}>
                      {r.type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{r.detail}</td>
                  <td className="py-2 px-3 text-right font-mono whitespace-nowrap" style={{ color: SEV_COLOR[r.sev] ?? "#94a3b8" }}>
                    {r.duration > 0 ? fmtMin(r.duration) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{filtered.length} lignes — page {page + 1} / {pages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30">Préc.</button>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30">Suiv.</button>
          </div>
        </div>
      )}
    </div>
  );
}
