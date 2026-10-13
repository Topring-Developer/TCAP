"use client";
import { AnalysisResult, fmtMin } from "@/lib/twms";

interface Props {
  data:      AnalysisResult;
  empFilter: string[];
  activeTab: string;
  onTab:     (tab: string) => void;
  hasNethris: boolean;
}

function KpiCard({
  title, value, sub, color, active, onClick, boldTitle,
}: {
  title: string; value: string | number; sub?: string;
  color: string; active: boolean; onClick: () => void; boldTitle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl p-4 flex flex-col gap-1 text-left w-full transition-all"
      style={{
        background: active ? "#1e3a5f" : "#1e293b",
        border: `1px solid ${active ? "#3b82f6" : "#334155"}`,
        boxShadow: active ? "0 0 0 2px #3b82f640" : "none",
      }}
    >
      <p className={`text-xs uppercase tracking-widest ${boldTitle ? "font-bold text-white" : "text-slate-400"}`}>{title}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </button>
  );
}

export default function KpiCards({ data, empFilter, activeTab, onTab, hasNethris }: Props) {
  const daily   = empFilter.length ? data.daily.filter(r => empFilter.includes(r.emp_key)) : data.daily;
  const absences = (empFilter.length ? data.absences.filter(r => empFilter.includes(r.emp_key)) : data.absences)
    .filter(r => !r.absence_type || r.absence_type === "Journée absente");
  const anoms   = data.anomalies.filter(a => {
    if (a.type === "Journée absente") return false;
    return empFilter.length ? empFilter.includes(a.emp_key) : true;
  });

  const nEmp   = data.ft_emps.length;
  const avgCov = daily.length ? +(daily.reduce((s, r) => s + r.coverage_pct, 0) / daily.length).toFixed(1) : 0;
  const covColor = avgCov >= 90 ? "#22c55e" : avgCov >= 75 ? "#f59e0b" : "#ef4444";
  const nAbs   = absences.length;

  let otLabel = "—";
  if (hasNethris && data.planned_summaries) {
    const ps = empFilter.length
      ? data.planned_summaries.filter(s => empFilter.includes(s.emp_key))
      : data.planned_summaries;
    const otHrs = ps.filter(s => s.gap_hrs > 0).reduce((s, r) => s + r.gap_hrs, 0);
    otLabel = `${Math.round(otHrs * 10) / 10}h`;
  } else {
    const wk = empFilter.length ? data.weekly.filter(r => empFilter.includes(r.emp_key)) : data.weekly;
    const otMin = wk.reduce((s, r) => s + r.overtime_min, 0);
    otLabel = fmtMin(otMin);
  }

  const totTrous     = anoms.filter(a => a.type === "Trou non loggé").length;
  const totAnomsOnly = anoms.filter(a => a.type !== "Trou non loggé").length;
  const logScore     = anoms.length;

  const cards = [
    {
      id: "employees",
      title: "Employés analysés",
      value: nEmp,
      sub: `${data.all_twms_emps.length} vus dans les logs`,
      color: "#22c55e",
    },
    {
      id: "resume",
      title: "Couverture moyenne",
      value: `${avgCov}%`,
      sub: "% du quart loggé dans TWMS",
      color: covColor,
    },
    ...(hasNethris ? [{
      id: "occupation",
      title: "Heures prévues / Nethris",
      value: (() => {
        const ps = empFilter.length && data.planned_summaries
          ? data.planned_summaries.filter(s => empFilter.includes(s.emp_key))
          : data.planned_summaries ?? [];
        const planned = ps.reduce((s, r) => s + r.planned_hrs, 0);
        const nethris = ps.reduce((s, r) => s + r.nethris_hrs, 0);
        return `${Math.round(nethris * 10) / 10}h / ${Math.round(planned * 10) / 10}h`;
      })(),
      sub: "Nethris réel / Planifié",
      color: "#22c55e",
    }] : []),
    {
      id: "logs",
      title: "Exactitude des logs",
      value: logScore === 0 ? "✓ 0 erreur" : `${logScore} problème${logScore > 1 ? "s" : ""}`,
      sub: `${totTrous} trou${totTrous > 1 ? "s" : ""} · ${totAnomsOnly} anomalie${totAnomsOnly > 1 ? "s" : ""}`,
      color: logScore === 0 ? "#22c55e" : logScore <= 5 ? "#f59e0b" : "#ef4444",
    },
    {
      id: "overtime",
      title: "Overtime",
      value: otLabel,
      sub: hasNethris ? "Nethris > heures prévues" : "Estimé — logs TWMS > 39.5h/sem.",
      color: otLabel === "0h 00m" || otLabel === "0h" ? "#22c55e" : "#ef4444",
    },
    {
      id: "absences",
      title: "Journées d'absence",
      value: nAbs,
      sub: "Jours sans log (temps plein)",
      color: nAbs === 0 ? "#22c55e" : nAbs <= 3 ? "#f59e0b" : "#ef4444",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${cards.length}, 1fr)` }}>
      {cards.map(c => (
        <KpiCard
          key={c.id}
          title={c.title}
          value={c.value}
          sub={c.sub}
          color={c.color}
          active={activeTab === c.id}
          onClick={() => onTab(c.id)}
          boldTitle={c.id === "employees"}
        />
      ))}
    </div>
  );
}
