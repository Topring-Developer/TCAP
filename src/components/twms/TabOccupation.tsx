"use client";

import { useMemo, useState } from "react";
import { ComparisonDay, EmpPlannedSummary } from "@/lib/twms";

interface Props {
  data:              ComparisonDay[];
  empFilter:         string[];
  plannedSummaries?: EmpPlannedSummary[];
}

const CAT_COLORS: Record<string, string> = {
  productive:     "#22c55e",
  non_productive: "#f59e0b",
  pause_paid:     "#60a5fa",
  pause_abnormal: "#ef4444",
  unknown:        "#dc2626",
};

function fmtHrs(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}`;
}

function rateColor(rate: number) {
  if (rate >= 85) return "#22c55e";
  if (rate >= 70) return "#f59e0b";
  return "#ef4444";
}

function gapColor(gap: number): string {
  if (gap >= -1)  return "#22c55e";
  if (gap >= -8)  return "#f59e0b";
  return "#ef4444";
}

interface EmpSummary {
  emp_key:         string;
  days:            number;
  avg_occ:         number;
  productive_hrs:  number;
  non_prod_hrs:    number;
  pause_paid_hrs:  number;
  abnormal_hrs:    number;
  unknown_hrs:     number;
  nethris_hrs:     number;
}

function buildSummaries(rows: ComparisonDay[]): EmpSummary[] {
  const map: Record<string, EmpSummary> = {};
  for (const r of rows) {
    if (!map[r.emp_key]) {
      map[r.emp_key] = { emp_key: r.emp_key, days: 0, avg_occ: 0, productive_hrs: 0, non_prod_hrs: 0, pause_paid_hrs: 0, abnormal_hrs: 0, unknown_hrs: 0, nethris_hrs: 0 };
    }
    const s = map[r.emp_key];
    s.days++;
    s.avg_occ         += r.occupation_rate;
    s.productive_hrs  += r.productive_min / 60;
    s.non_prod_hrs    += r.non_prod_min / 60;
    s.pause_paid_hrs  += r.pause_paid_min / 60;
    s.abnormal_hrs    += r.abnormal_min / 60;
    s.unknown_hrs     += r.unknown_min / 60;
    s.nethris_hrs     += r.nethris_hrs;
  }
  return Object.values(map).map(s => ({
    ...s,
    avg_occ:        Math.round(s.avg_occ / s.days * 10) / 10,
    productive_hrs: Math.round(s.productive_hrs * 10) / 10,
    non_prod_hrs:   Math.round(s.non_prod_hrs * 10) / 10,
    pause_paid_hrs: Math.round(s.pause_paid_hrs * 10) / 10,
    abnormal_hrs:   Math.round(s.abnormal_hrs * 10) / 10,
    unknown_hrs:    Math.round(s.unknown_hrs * 10) / 10,
    nethris_hrs:    Math.round(s.nethris_hrs * 10) / 10,
  })).sort((a, b) => b.avg_occ - a.avg_occ);
}

function DayDetail({ day }: { day: ComparisonDay }) {
  const pieData = [
    { name: "Productif",     value: day.productive_min,  color: CAT_COLORS.productive     },
    { name: "Non-productif", value: day.non_prod_min,    color: CAT_COLORS.non_productive },
    { name: "Pause payée",   value: day.pause_paid_min,  color: CAT_COLORS.pause_paid     },
    { name: "Pause anormale",value: day.abnormal_min,    color: CAT_COLORS.pause_abnormal },
    { name: "Non conforme",  value: day.unknown_min,     color: CAT_COLORS.unknown        },
  ].filter(d => d.value > 0);

  return (
    <div className="mt-4 rounded-xl p-4" style={{ background: "#1e293b" }}>
      <p className="text-slate-300 text-sm font-semibold mb-3">
        {day.emp_key} — {day.date}
        <span className="ml-3" style={{ color: rateColor(day.occupation_rate) }}>
          {day.occupation_rate}% occupation
        </span>
        <span className="text-slate-400 ml-3">Nethris : {day.nethris_hrs}h payées</span>
      </p>
      <div className="flex h-6 rounded-full overflow-hidden mb-3">
        {pieData.map(d => (
          <div key={d.name} style={{ width: `${(d.value / day.total_logged_min) * 100}%`, background: d.color }} title={`${d.name} : ${fmtHrs(d.value)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {pieData.map(d => (
          <span key={d.name} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.color }} />
            <span className="text-slate-300">{d.name}</span>
            <span className="text-slate-400">{fmtHrs(d.value)}</span>
          </span>
        ))}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 text-left border-b border-slate-700">
            <th className="py-1 pr-3">Heure</th>
            <th className="py-1 pr-3">Activité</th>
            <th className="py-1 pr-3">Catégorie</th>
            <th className="py-1 text-right">Durée</th>
          </tr>
        </thead>
        <tbody>
          {day.activities.map((a, i) => (
            <tr key={i} className="border-b border-slate-800">
              <td className="py-1 pr-3 text-slate-400">{a.start}</td>
              <td className="py-1 pr-3 text-white">{a.name}</td>
              <td className="py-1 pr-3">
                <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: `${CAT_COLORS[a.category] ?? "#64748b"}22`, color: CAT_COLORS[a.category] ?? "#94a3b8" }}>
                  {a.label}
                </span>
              </td>
              <td className="py-1 text-right text-slate-300">{fmtHrs(a.dur_min)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlannedVsNethris({ summaries, empFilter }: { summaries: EmpPlannedSummary[]; empFilter: string[] }) {
  const filtered = empFilter.length > 0 ? summaries.filter(s => empFilter.includes(s.emp_key)) : summaries;
  const totals = filtered.reduce(
    (acc, s) => ({ planned: acc.planned + s.planned_hrs, nethris: acc.nethris + s.nethris_hrs, gap: acc.gap + s.gap_hrs }),
    { planned: 0, nethris: 0, gap: 0 }
  );

  return (
    <div className="rounded-xl p-4 mb-6" style={{ background: "#1e293b" }}>
      <p className="text-slate-300 text-sm font-semibold mb-1">Heures planifiées vs Heures Nethris réelles</p>
      <p className="text-slate-500 text-xs mb-4">
        L&apos;écart devrait être expliqué par les congés/absences approuvés. Positif = Nethris &gt; planifié.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Total planifié", value: `${Math.round(totals.planned * 10) / 10}h`, color: "#60a5fa" },
          { label: "Total Nethris",  value: `${Math.round(totals.nethris * 10) / 10}h`, color: "#22c55e" },
          { label: "Écart total",    value: `${totals.gap >= 0 ? "+" : ""}${Math.round(totals.gap * 10) / 10}h`, color: gapColor(totals.gap) },
        ].map(k => (
          <div key={k.label} className="rounded-lg p-3" style={{ background: "#0f172a" }}>
            <p className="text-slate-400 text-xs mb-1">{k.label}</p>
            <p className="text-xl font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-700">
              <th className="py-2 pr-4">Employé</th>
              <th className="py-2 pr-3 text-right">Jours ouv.</th>
              <th className="py-2 pr-3 text-right">Planifié</th>
              <th className="py-2 pr-3 text-right">Nethris</th>
              <th className="py-2 pr-3 text-right">Écart</th>
              <th className="py-2 pr-3 text-right">Congés approuvés</th>
              <th className="py-2 pr-3 text-right">Congé maladie</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.emp_key} className="border-b border-slate-800 hover:bg-slate-700/20">
                <td className="py-1.5 pr-4 text-white font-medium">{s.emp_key}</td>
                <td className="py-1.5 pr-3 text-right text-slate-300">{s.working_days}</td>
                <td className="py-1.5 pr-3 text-right text-blue-400">{s.planned_hrs}h</td>
                <td className="py-1.5 pr-3 text-right text-green-400">{s.nethris_hrs}h</td>
                <td className="py-1.5 pr-3 text-right font-bold" style={{ color: gapColor(s.gap_hrs) }}>
                  {s.gap_hrs >= 0 ? "+" : ""}{s.gap_hrs}h
                </td>
                <td className="py-1.5 pr-3 text-right text-slate-300">
                  {s.approved_days > 0 ? `${s.approved_days} jour${s.approved_days > 1 ? "s" : ""}` : "—"}
                </td>
                <td className="py-1.5 pr-3 text-right text-slate-300">
                  {s.sick_days > 0 ? <span className="text-yellow-500">{s.sick_days} jour{s.sick_days > 1 ? "s" : ""}</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TabOccupation({ data, empFilter, plannedSummaries }: Props) {
  const [selectedDay, setSelectedDay] = useState<ComparisonDay | null>(null);
  const [viewMode,    setViewMode]    = useState<"summary" | "detail">("summary");

  const filtered  = useMemo(
    () => empFilter.length > 0 ? data.filter(d => empFilter.includes(d.emp_key)) : data,
    [data, empFilter]
  );
  const summaries = useMemo(() => buildSummaries(filtered), [filtered]);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Taux d'occupation moyen",   value: summaries.length > 0 ? `${Math.round(summaries.reduce((s, e) => s + e.avg_occ, 0) / summaries.length * 10) / 10}%` : "—", color: "#60a5fa" },
          { label: "Heures productives totales", value: `${Math.round(summaries.reduce((s, e) => s + e.productive_hrs, 0) * 10) / 10}h`, color: "#22c55e" },
          { label: "Heures non-prod reconnues",  value: `${Math.round(summaries.reduce((s, e) => s + e.non_prod_hrs, 0) * 10) / 10}h`,  color: "#f59e0b" },
          { label: "Pauses anormales",           value: `${Math.round(summaries.reduce((s, e) => s + e.abnormal_hrs, 0) * 10) / 10}h`,  color: "#ef4444" },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-4" style={{ background: "#1e293b" }}>
            <p className="text-slate-400 text-xs mb-1">{k.label}</p>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {plannedSummaries && plannedSummaries.length > 0 && (
        <PlannedVsNethris summaries={plannedSummaries} empFilter={empFilter} />
      )}

      <div className="flex gap-2 mb-4">
        {(["summary", "detail"] as const).map(m => (
          <button key={m} onClick={() => setViewMode(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewMode === m ? "bg-primary text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
            {m === "summary" ? "Résumé par employé" : "Détail par jour"}
          </button>
        ))}
      </div>

      {viewMode === "summary" && (
        <div className="overflow-x-auto rounded-xl" style={{ background: "#1e293b" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                <th className="py-3 px-4">Employé</th>
                <th className="py-3 px-3 text-right">Jours</th>
                <th className="py-3 px-3 text-right">Taux occ.</th>
                <th className="py-3 px-3 text-right">Productif</th>
                <th className="py-3 px-3 text-right">Non-prod</th>
                <th className="py-3 px-3 text-right">Pause payée</th>
                <th className="py-3 px-3 text-right">Pause anorm.</th>
                <th className="py-3 px-3 text-right">Non conf.</th>
                <th className="py-3 px-3 text-right">Nethris</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => (
                <tr key={s.emp_key} className="border-b border-slate-800 hover:bg-slate-700/30">
                  <td className="py-2 px-4 text-white font-medium">{s.emp_key}</td>
                  <td className="py-2 px-3 text-right text-slate-300">{s.days}</td>
                  <td className="py-2 px-3 text-right font-bold" style={{ color: rateColor(s.avg_occ) }}>{s.avg_occ}%</td>
                  <td className="py-2 px-3 text-right text-green-400">{s.productive_hrs}h</td>
                  <td className="py-2 px-3 text-right text-yellow-400">{s.non_prod_hrs}h</td>
                  <td className="py-2 px-3 text-right text-blue-400">{s.pause_paid_hrs}h</td>
                  <td className="py-2 px-3 text-right" style={{ color: s.abnormal_hrs > 0 ? "#ef4444" : "#94a3b8" }}>{s.abnormal_hrs > 0 ? `${s.abnormal_hrs}h` : "—"}</td>
                  <td className="py-2 px-3 text-right" style={{ color: s.unknown_hrs > 0 ? "#dc2626" : "#94a3b8" }}>{s.unknown_hrs > 0 ? `${s.unknown_hrs}h` : "—"}</td>
                  <td className="py-2 px-3 text-right text-slate-300">{s.nethris_hrs}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === "detail" && (
        <div className="overflow-x-auto rounded-xl mb-4" style={{ background: "#1e293b" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                <th className="py-3 px-4">Employé</th>
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3 text-right">Taux occ.</th>
                <th className="py-3 px-3 text-right">Productif</th>
                <th className="py-3 px-3 text-right">Non-prod</th>
                <th className="py-3 px-3 text-right">Pause anorm.</th>
                <th className="py-3 px-3 text-right">Non conf.</th>
                <th className="py-3 px-3 text-right">Nethris</th>
                <th className="py-3 px-3 text-right">Écart TWMS/Nethris</th>
                <th className="py-3 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <>
                  <tr
                    key={`${r.emp_key}-${r.date}-${i}`}
                    className={`border-b border-slate-800 cursor-pointer hover:bg-slate-700/30 ${selectedDay === r ? "bg-slate-700/20" : ""}`}
                    onClick={() => setSelectedDay(selectedDay === r ? null : r)}
                  >
                    <td className="py-2 px-4 text-white">{r.emp_key}</td>
                    <td className="py-2 px-3 text-slate-300">{r.date}</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: rateColor(r.occupation_rate) }}>{r.occupation_rate}%</td>
                    <td className="py-2 px-3 text-right text-green-400">{fmtHrs(r.productive_min)}</td>
                    <td className="py-2 px-3 text-right text-yellow-400">{fmtHrs(r.non_prod_min)}</td>
                    <td className="py-2 px-3 text-right" style={{ color: r.abnormal_min > 0 ? "#ef4444" : "#94a3b8" }}>{r.abnormal_min > 0 ? fmtHrs(r.abnormal_min) : "—"}</td>
                    <td className="py-2 px-3 text-right" style={{ color: r.unknown_min > 0 ? "#dc2626" : "#94a3b8" }}>{r.unknown_min > 0 ? fmtHrs(r.unknown_min) : "—"}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{r.nethris_hrs}h</td>
                    <td className="py-2 px-3 text-right font-mono text-xs font-bold"
                        style={{ color: r.gap_vs_nethris_min >= -15 && r.gap_vs_nethris_min <= 15 ? "#22c55e" : r.gap_vs_nethris_min < -30 ? "#ef4444" : "#f59e0b" }}>
                      {r.gap_vs_nethris_min >= 0 ? "+" : ""}{fmtHrs(Math.abs(r.gap_vs_nethris_min))}
                      {r.gap_vs_nethris_min < 0 ? " ↓" : r.gap_vs_nethris_min > 15 ? " ↑" : ""}
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-xs">{selectedDay === r ? "▲" : "▼"}</td>
                  </tr>
                  {selectedDay === r && (
                    <tr key={`${r.emp_key}-${r.date}-detail`}>
                      <td colSpan={10} className="px-4 pb-4">
                        <DayDetail day={r} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
