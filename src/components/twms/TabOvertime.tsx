"use client";
import { AnalysisResult, EmpPlannedSummary, fmtMin } from "@/lib/twms";

interface Props { data: AnalysisResult; empFilter: string[] }

const DARK = { background: "#1e293b", border: "1px solid #334155" };

export default function TabOvertime({ data, empFilter }: Props) {
  const hasNethris = !!(data.planned_summaries && data.planned_summaries.length > 0);

  if (hasNethris) {
    const summaries: EmpPlannedSummary[] = (empFilter.length
      ? data.planned_summaries!.filter(s => empFilter.includes(s.emp_key))
      : data.planned_summaries!
    ).sort((a, b) => b.gap_hrs - a.gap_hrs);

    const withOt  = summaries.filter(s => s.gap_hrs > 0);
    const totalOt = withOt.reduce((s, r) => s + r.gap_hrs, 0);

    return (
      <div className="space-y-4">
        <div className="rounded-xl p-3 text-sm" style={{ background: "#0c2340", border: "1px solid #1d4ed8", color: "#93c5fd" }}>
          ℹ️ L&apos;overtime est calculé à partir des heures <strong>payées par Nethris</strong> vs les heures
          planifiées selon l&apos;horaire de l&apos;employé.
          Si Nethris &gt; prévu = overtime. Si Nethris &lt; prévu = sous-temps (congé, absence, etc.).
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-4" style={DARK}>
            <p className="text-slate-400 text-xs mb-1">Employés en overtime</p>
            <p className="text-2xl font-bold text-red-400">{withOt.length}</p>
          </div>
          <div className="rounded-xl p-4" style={DARK}>
            <p className="text-slate-400 text-xs mb-1">Total heures en overtime</p>
            <p className="text-2xl font-bold text-red-400">{Math.round(totalOt * 10) / 10}h</p>
          </div>
          <div className="rounded-xl p-4" style={DARK}>
            <p className="text-slate-400 text-xs mb-1">Employés sans overtime</p>
            <p className="text-2xl font-bold text-green-400">{summaries.length - withOt.length}</p>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={DARK}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                <th className="py-3 px-4">Employé</th>
                <th className="py-3 px-3 text-right">Jours ouv.</th>
                <th className="py-3 px-3 text-right">Heures prévues</th>
                <th className="py-3 px-3 text-right">Heures Nethris</th>
                <th className="py-3 px-3 text-right">Écart</th>
                <th className="py-3 px-3 text-right">Statut</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => {
                const isOt    = s.gap_hrs > 0;
                const isUnder = s.gap_hrs < -0.5;
                const color   = isOt ? "#ef4444" : isUnder ? "#f59e0b" : "#22c55e";
                const label   = isOt ? `+${s.gap_hrs}h OVERTIME` : isUnder ? `${s.gap_hrs}h sous-temps` : "✓ Normal";
                return (
                  <tr key={s.emp_key} className="border-b border-slate-800 hover:bg-slate-700/20">
                    <td className="py-2 px-4 text-white font-medium">{s.emp_key}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{s.working_days}</td>
                    <td className="py-2 px-3 text-right text-blue-400">{s.planned_hrs}h</td>
                    <td className="py-2 px-3 text-right text-green-400">{s.nethris_hrs}h</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color }}>
                      {s.gap_hrs > 0 ? "+" : ""}{s.gap_hrs}h
                    </td>
                    <td className="py-2 px-3 text-right text-xs font-semibold" style={{ color }}>{label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const weekly = empFilter.length
    ? data.weekly.filter(r => empFilter.includes(r.emp_key))
    : data.weekly;

  const byEmp: Record<string, { work_min: number; ot_min: number; weeks: number }> = {};
  for (const r of weekly) {
    if (!byEmp[r.emp_key]) byEmp[r.emp_key] = { work_min: 0, ot_min: 0, weeks: 0 };
    byEmp[r.emp_key].work_min += r.work_min;
    byEmp[r.emp_key].ot_min  += r.overtime_min;
    byEmp[r.emp_key].weeks++;
  }
  const rows = Object.entries(byEmp)
    .map(([emp, v]) => ({ emp, work_hrs: Math.round(v.work_min / 60 * 10) / 10, ot_hrs: Math.round(v.ot_min / 60 * 10) / 10, weeks: v.weeks }))
    .sort((a, b) => b.ot_hrs - a.ot_hrs);

  const totalOtMin = weekly.reduce((s, r) => s + r.overtime_min, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-sm" style={{ background: "#451a03", border: "1px solid #92400e", color: "#fcd34d" }}>
        ⚠️ Sans fichier Nethris, l&apos;overtime est estimé à partir des logs TWMS : heures loggées &gt; 39,5h/semaine.
        Cette mesure est approximative — importez le rapport Nethris pour un calcul exact.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-4" style={DARK}>
          <p className="text-slate-400 text-xs mb-1">Overtime total estimé (logs TWMS)</p>
          <p className="text-2xl font-bold text-red-400">{fmtMin(totalOtMin)}</p>
        </div>
        <div className="rounded-xl p-4" style={DARK}>
          <p className="text-slate-400 text-xs mb-1">Employés avec overtime TWMS</p>
          <p className="text-2xl font-bold text-red-400">{rows.filter(r => r.ot_hrs > 0).length}</p>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={DARK}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
              <th className="py-3 px-4">Employé</th>
              <th className="py-3 px-3 text-right">Semaines</th>
              <th className="py-3 px-3 text-right">Heures loggées</th>
              <th className="py-3 px-3 text-right">Overtime estimé</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.emp} className="border-b border-slate-800 hover:bg-slate-700/20">
                <td className="py-2 px-4 text-white">{r.emp}</td>
                <td className="py-2 px-3 text-right text-slate-300">{r.weeks}</td>
                <td className="py-2 px-3 text-right text-slate-300">{r.work_hrs}h</td>
                <td className="py-2 px-3 text-right font-bold" style={{ color: r.ot_hrs > 0 ? "#ef4444" : "#94a3b8" }}>
                  {r.ot_hrs > 0 ? `${r.ot_hrs}h` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
