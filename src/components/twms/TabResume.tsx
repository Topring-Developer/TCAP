"use client";
import { AnalysisResult, covColor, fmtMin } from "@/lib/twms";

interface Props { data: AnalysisResult; empFilter: string[] }

const DARK = { background: "#1e293b", border: "1px solid #334155" };

export default function TabResume({ data, empFilter }: Props) {
  const daily  = empFilter.length ? data.daily.filter(r => empFilter.includes(r.emp_key)) : data.daily;
  const weekly = empFilter.length ? data.weekly.filter(r => empFilter.includes(r.emp_key)) : data.weekly;

  const summary: Record<string, {
    jours: number; covSum: number; trous: number; nbTrous: number;
    erreurs: number; retards: number; departsTot: number;
  }> = {};
  for (const r of daily) {
    if (!summary[r.emp_key]) summary[r.emp_key] = { jours: 0, covSum: 0, trous: 0, nbTrous: 0, erreurs: 0, retards: 0, departsTot: 0 };
    const s = summary[r.emp_key];
    s.jours++; s.covSum += r.coverage_pct; s.trous += r.total_gaps_min;
    s.nbTrous += r.gap_count; s.erreurs += r.error_count;
    if (r.late_arrival_min > 0) s.retards++;
    if (r.early_dep_min > 0) s.departsTot++;
  }

  const otByEmp: Record<string, number> = {};
  for (const r of weekly) otByEmp[r.emp_key] = (otByEmp[r.emp_key] || 0) + r.overtime_min;

  const rows = Object.entries(summary)
    .map(([emp, s]) => ({
      emp,
      jours:    s.jours,
      cov:      +(s.covSum / s.jours).toFixed(1),
      trous:    fmtMin(s.trous),
      nbTrous:  s.nbTrous,
      erreurs:  s.erreurs,
      retards:  s.retards,
      departs:  s.departsTot,
    }))
    .sort((a, b) => a.cov - b.cov);

  const avgCov = daily.length ? (daily.reduce((s, r) => s + r.coverage_pct, 0) / daily.length).toFixed(1) : "—";
  const totTrous = daily.reduce((s, r) => s + r.total_gaps_min, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-sm" style={{ background: "#0c2340", border: "1px solid #1d4ed8", color: "#93c5fd" }}>
        ℹ️ La <strong>couverture</strong> mesure le rapport entre le temps réellement loggé dans TWMS et le temps
        de quart attendu. 100% = toutes les minutes du quart sont loggées.
        Un taux bas indique des trous ou des débuts/fins de session qui ne correspondent pas à l&apos;horaire.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-4" style={DARK}>
          <p className="text-slate-400 text-xs mb-1">Couverture moyenne globale</p>
          <p className="text-3xl font-bold" style={{ color: covColor(parseFloat(avgCov)) }}>{avgCov}%</p>
        </div>
        <div className="rounded-xl p-4" style={DARK}>
          <p className="text-slate-400 text-xs mb-1">Total trous non loggés</p>
          <p className="text-3xl font-bold text-yellow-400">{fmtMin(totTrous)}</p>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={DARK}>
        <div className="px-4 py-3 border-b border-slate-700">
          <p className="text-slate-300 text-sm font-semibold">Résumé par employé</p>
          <p className="text-slate-500 text-xs">Trié du moins bien couvert au mieux couvert.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                {["Employé","Jours","Couverture","Trous","Nb trous","Erreurs","Retards","Départs tôt"].map(h => (
                  <th key={h} className="py-3 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/20">
                  <td className="py-2 px-3 text-white font-medium">{r.emp}</td>
                  <td className="py-2 px-3 text-slate-300">{r.jours}</td>
                  <td className="py-2 px-3 font-bold text-lg" style={{ color: covColor(r.cov) }}>{r.cov}%</td>
                  <td className="py-2 px-3 text-slate-300">{r.trous}</td>
                  <td className="py-2 px-3" style={{ color: r.nbTrous > 0 ? "#f59e0b" : "#94a3b8" }}>{r.nbTrous || "—"}</td>
                  <td className="py-2 px-3" style={{ color: r.erreurs > 0 ? "#ef4444" : "#94a3b8" }}>{r.erreurs || "—"}</td>
                  <td className="py-2 px-3" style={{ color: r.retards > 0 ? "#f59e0b" : "#94a3b8" }}>{r.retards || "—"}</td>
                  <td className="py-2 px-3" style={{ color: r.departs > 0 ? "#f59e0b" : "#94a3b8" }}>{r.departs || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
