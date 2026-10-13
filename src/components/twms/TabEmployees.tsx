"use client";
import { AnalysisResult } from "@/lib/twms";

interface Props { data: AnalysisResult }

const DARK = { background: "#1e293b", border: "1px solid #334155" };

export default function TabEmployees({ data }: Props) {
  const analyzed    = data.ft_emps;
  const allTwms     = data.all_twms_emps;
  const notAnalyzed = allTwms.filter(e => !analyzed.includes(e));

  return (
    <div className="space-y-5">
      <div className="rounded-xl p-3 text-sm" style={{ background: "#0c2340", border: "1px solid #1d4ed8", color: "#93c5fd" }}>
        ℹ️ Les employés <strong>analysés</strong> ont un horaire configuré dans TCAP (temps plein ou suivi).
        Les employés <strong>vus dans les logs mais non analysés</strong> n&apos;ont pas d&apos;horaire défini —
        leurs activités ne génèrent pas de calcul de couverture ni d&apos;anomalie.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-xl overflow-hidden" style={DARK}>
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            <p className="text-slate-200 text-sm font-semibold">Employés analysés</p>
            <span className="ml-auto text-green-400 font-bold text-sm">{analyzed.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs border-b border-slate-700">
                <th className="py-2 px-4">Nom</th>
                <th className="py-2 px-3 text-right">Jours loggés</th>
                <th className="py-2 px-3 text-right">Couverture moy.</th>
              </tr>
            </thead>
            <tbody>
              {analyzed.map(emp => {
                const days = data.daily.filter(d => d.emp_key === emp);
                const cov = days.length
                  ? (days.reduce((s, d) => s + d.coverage_pct, 0) / days.length).toFixed(1)
                  : "—";
                const covNum = days.length ? parseFloat(cov) : -1;
                const color = covNum >= 90 ? "#22c55e" : covNum >= 75 ? "#f59e0b" : "#ef4444";
                return (
                  <tr key={emp} className="border-b border-slate-800 hover:bg-slate-700/20">
                    <td className="py-2 px-4 text-white">{emp}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{days.length}</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: days.length ? color : "#94a3b8" }}>
                      {days.length ? `${cov}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl overflow-hidden" style={DARK}>
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
            <p className="text-slate-200 text-sm font-semibold">Vus dans les logs — non analysés</p>
            <span className="ml-auto text-slate-400 font-bold text-sm">{notAnalyzed.length}</span>
          </div>
          {notAnalyzed.length === 0 ? (
            <p className="text-slate-500 text-sm p-4">Tous les employés dans les logs sont analysés.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs border-b border-slate-700">
                  <th className="py-2 px-4">Nom (clé TWMS)</th>
                  <th className="py-2 px-3 text-right">Activités loggées</th>
                </tr>
              </thead>
              <tbody>
                {notAnalyzed.map(emp => {
                  const count = data.daily.filter(d => d.emp_key === emp).length;
                  return (
                    <tr key={emp} className="border-b border-slate-800 hover:bg-slate-700/20">
                      <td className="py-2 px-4 text-slate-400">{emp}</td>
                      <td className="py-2 px-3 text-right text-slate-500">{count || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-700">
            Pour les analyser, ajoutez un mapping TWMS à cet employé dans TCAP et assignez-lui un horaire.
          </div>
        </div>
      </div>
    </div>
  );
}
