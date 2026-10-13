"use client";
import { AnalysisResult } from "@/lib/twms";

interface Props { data: AnalysisResult; empFilter: string[] }

const DARK = { background: "#1e293b", border: "1px solid #334155" };

export default function TabAbsences({ data, empFilter }: Props) {
  const absences = (empFilter.length
    ? data.absences.filter(r => empFilter.includes(r.emp_key))
    : data.absences
  ).sort((a, b) => a.prenom.localeCompare(b.prenom) || a.date.localeCompare(b.date));

  if (absences.length === 0) {
    return <p className="text-slate-400 p-4">Aucune journée sans log détectée pour les temps plein.</p>;
  }

  const byEmp: Record<string, number> = {};
  for (const a of absences) byEmp[a.emp_key] = (byEmp[a.emp_key] || 0) + 1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-sm" style={{ background: "#0c2340", border: "1px solid #1d4ed8", color: "#93c5fd" }}>
        ℹ️ Ce rapport liste les journées ouvrables sans aucun log TWMS pour les employés à temps plein.
        Cela peut indiquer une absence, un congé, ou simplement une journée sans session ouverte dans TWMS.
        Les congés approuvés (Nethris) et les fériés sont automatiquement exclus.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(byEmp).sort((a, b) => b[1] - a[1]).map(([emp, n]) => (
          <div key={emp} className="rounded-xl p-3" style={DARK}>
            <p className="text-slate-400 text-xs truncate">{emp}</p>
            <p className="text-2xl font-bold" style={{ color: n > 3 ? "#ef4444" : n > 1 ? "#f59e0b" : "#94a3b8" }}>{n} jour{n > 1 ? "s" : ""}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-3 text-sm" style={{ background: "#451a03", border: "1px solid #92400e", color: "#fcd34d" }}>
        ⚠️ Ces journées peuvent correspondre à des congés, vacances ou absences autorisées.
        Ce rapport est un outil d&apos;aide — à valider avant toute action.
      </div>

      <div className="rounded-xl overflow-hidden" style={DARK}>
        <div className="px-4 py-3 border-b border-slate-700">
          <p className="text-slate-300 text-sm font-semibold">Détail — {absences.length} journée{absences.length > 1 ? "s" : ""} sans log</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                {["Date","Employé","Jour","Semaine","Type"].map(h => (
                  <th key={h} className="py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {absences.map((r, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/20">
                  <td className="py-2 px-4 text-slate-300">{r.date}</td>
                  <td className="py-2 px-4 text-white">{r.prenom} {r.nom}</td>
                  <td className="py-2 px-4 text-slate-400">{r.weekday_name}</td>
                  <td className="py-2 px-4 text-slate-400">{r.week_label}</td>
                  <td className="py-2 px-4">
                    {r.absence_type ? (
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#1e3a5f", color: "#93c5fd" }}>{r.absence_type}</span>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
