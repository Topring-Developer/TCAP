"use client";

import { useState, useCallback, useEffect } from "react";
import UploadZone    from "@/components/twms/UploadZone";
import KpiCards      from "@/components/twms/KpiCards";
import TabResume     from "@/components/twms/TabResume";
import TabEmployees  from "@/components/twms/TabEmployees";
import TabOccupation from "@/components/twms/TabOccupation";
import TabOvertime   from "@/components/twms/TabOvertime";
import TabAbsences   from "@/components/twms/TabAbsences";
import TabLogs       from "@/components/twms/TabLogs";
import { AnalysisResult } from "@/lib/twms";
import { parseNethrisFile } from "@/utils/parseNethrisClient";
import { createClient } from "@/lib/supabase/client";
import type { CapacityEvent, EmployeeLeave, Employee } from "@/lib/supabase/types";
import { getEventDisplayLabel, LEAVE_REASON_LABELS } from "@/lib/capacity";

// Extrait les dates depuis le nom du fichier activities_YYYY-MM-DD_to_YYYY-MM-DD.csv
function parseDatesFromFilename(name: string): { from: string; to: string } | null {
  const m = name.match(/(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})/);
  return m ? { from: m[1], to: m[2] } : null;
}

// ─── Panneau Contexte TCAP ────────────────────────────────────────────────────

type TcapContext = {
  events: (CapacityEvent & { employees: Pick<Employee, "id" | "full_name"> })[];
  leaves: (EmployeeLeave & { employees: Pick<Employee, "id" | "full_name"> })[];
};

function TcapContextPanel({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const supabase = createClient();
  const [ctx, setCtx] = useState<TcapContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    Promise.all([
      supabase
        .from("capacity_events")
        .select("*, employees(id, full_name)")
        .lt("start_datetime", dateTo + "T23:59:59")
        .gt("end_datetime",   dateFrom + "T00:00:00")
        .order("start_datetime"),
      supabase
        .from("employee_leaves")
        .select("*, employees(id, full_name)")
        .lte("start_date", dateTo)
        .or(`end_date.is.null,end_date.gte.${dateFrom}`)
        .order("start_date"),
    ]).then(([{ data: evs }, { data: lvs }]) => {
      setCtx({
        events: (evs as TcapContext["events"]) ?? [],
        leaves: (lvs as TcapContext["leaves"]) ?? [],
      });
      setLoading(false);
    });
  }, [dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dateFrom || !dateTo) return null;

  const total = (ctx?.events.length ?? 0) + (ctx?.leaves.length ?? 0);

  return (
    <div className="mt-6 rounded-xl overflow-hidden" style={{ background: "#0f2a1a", border: "1px solid #166534" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div>
          <p className="text-green-300 font-semibold text-sm">
            📋 Contexte TCAP — événements de la période
          </p>
          <p className="text-green-600 text-xs mt-0.5">
            {loading ? "Chargement…" : `${total} entrée${total !== 1 ? "s" : ""} (absences, OT, congés prolongés)`}
          </p>
        </div>
        <span className="text-green-500 text-xs">{open ? "▲ Réduire" : "▼ Afficher"}</span>
      </button>

      {open && !loading && ctx && (
        <div className="px-5 pb-5">
          {total === 0 ? (
            <p className="text-slate-400 text-sm py-3">Aucun événement enregistré dans TCAP pour cette période.</p>
          ) : (
            <div className="space-y-4">
              {/* Événements de capacité */}
              {ctx.events.length > 0 && (
                <div>
                  <p className="text-green-400 text-xs font-semibold uppercase tracking-wider mb-2">
                    Événements de capacité ({ctx.events.length})
                  </p>
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #14532d" }}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "#052e16" }}>
                          {["Employé", "Type", "Début", "Fin", "Note"].map((h) => (
                            <th key={h} className="text-left px-3 py-2 text-green-500 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ctx.events.map((ev) => (
                          <tr key={ev.id} style={{ borderTop: "1px solid #14532d" }}
                            className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-medium">{ev.employees?.full_name}</td>
                            <td className="px-3 py-2 text-green-300">{getEventDisplayLabel(ev)}</td>
                            <td className="px-3 py-2 text-slate-300">{ev.start_datetime.slice(0, 16).replace("T", " ")}</td>
                            <td className="px-3 py-2 text-slate-300">{ev.end_datetime.slice(0, 16).replace("T", " ")}</td>
                            <td className="px-3 py-2 text-slate-400 max-w-xs truncate">{ev.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Congés prolongés */}
              {ctx.leaves.length > 0 && (
                <div>
                  <p className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-2">
                    Congés prolongés ({ctx.leaves.length})
                  </p>
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #92400e" }}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "#451a03" }}>
                          {["Employé", "Raison", "Début", "Fin", "Note"].map((h) => (
                            <th key={h} className="text-left px-3 py-2 text-amber-400 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ctx.leaves.map((lv) => (
                          <tr key={lv.id} style={{ borderTop: "1px solid #92400e" }}
                            className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-medium">{lv.employees?.full_name}</td>
                            <td className="px-3 py-2 text-amber-300">{LEAVE_REASON_LABELS[lv.reason] ?? lv.reason}</td>
                            <td className="px-3 py-2 text-slate-300">{lv.start_date}</td>
                            <td className="px-3 py-2 text-slate-300">{lv.end_date ?? <span className="text-slate-500 italic">en cours</span>}</td>
                            <td className="px-3 py-2 text-slate-400 max-w-xs truncate">{lv.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function TwmsPage() {
  const [activitiesFile, setActivitiesFile] = useState<File | null>(null);
  const [nethrisFile,    setNethrisFile]    = useState<File | null>(null);
  const [dateFrom,       setDateFrom]       = useState("");
  const [dateTo,         setDateTo]         = useState("");
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [result,         setResult]         = useState<AnalysisResult | null>(null);
  const [activeTab,      setActiveTab]      = useState("resume");
  const [empFilter,      setEmpFilter]      = useState<string[]>([]);

  const handleActivitiesFile = (file: File | null) => {
    setActivitiesFile(file);
    if (file) {
      const parsed = parseDatesFromFilename(file.name);
      if (parsed) { setDateFrom(parsed.from); setDateTo(parsed.to); }
    }
  };

  const handleAnalyze = useCallback(async () => {
    if (!activitiesFile) return;
    setLoading(true);
    setError(null);

    try {
      const activitiesCsv = await activitiesFile.text();

      let nethrisRows = undefined;
      if (nethrisFile) {
        nethrisRows = await parseNethrisFile(nethrisFile);
      }

      // ⚠️ L'URL pointe vers la route TCAP : /api/twms/analyze
      const res  = await fetch("/api/twms/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activitiesCsv,
          nethrisRows,
          dateFrom: dateFrom || undefined,
          dateTo:   dateTo   || undefined,
        }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || "Erreur serveur");
      setResult(json as AnalysisResult);
      setEmpFilter([]);
      setActiveTab("resume");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activitiesFile, nethrisFile, dateFrom, dateTo]);

  const toggleEmp = (emp: string) => {
    setEmpFilter(prev =>
      prev.includes(emp) ? prev.filter(e => e !== emp) : [...prev, emp]
    );
  };

  const hasNethris = !!(result?.comparison);

  return (
    <div className="min-h-screen" style={{ background: "#0f172a" }}>
      <header className="px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-2 border-b border-slate-700">
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">
            📦 Analyse des Logs Entrepôt — TOPRINGS
          </h1>
          {result && (
            <p className="text-slate-400 text-sm">
              Période : {result.period} &nbsp;|&nbsp; {result.ft_emps.length} employés analysés
              {hasNethris && <span className="text-green-400 ml-2">✓ Nethris actif</span>}
            </p>
          )}
        </div>

        {result && (
          <div className="sm:ml-auto flex flex-wrap gap-2 items-center">
            <span className="text-slate-400 text-xs">Filtrer :</span>
            {result.ft_emps.map(emp => (
              <button
                key={emp}
                onClick={() => toggleEmp(emp)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  empFilter.includes(emp)
                    ? "bg-primary text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {emp.split(" ")[0]}
              </button>
            ))}
            {empFilter.length > 0 && (
              <button
                onClick={() => setEmpFilter([])}
                className="px-2 py-1 rounded-md text-xs bg-slate-600 text-slate-300 hover:bg-slate-500"
              >
                ✕ Tous
              </button>
            )}
          </div>
        )}
      </header>

      <main className="px-6 py-5">

        {!result && (
          <div className="max-w-2xl mx-auto mt-10">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Analyser les logs d&apos;activité</h2>
              <p className="text-slate-400 text-sm">Déposez vos fichiers pour générer le dashboard</p>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-2">
                  Fichier TWMS <span className="text-red-400">*requis</span>
                </p>
                <UploadZone
                  label="Logs d'activité TWMS"
                  hint="activities_XXXX.csv (séparateur ;)"
                  file={activitiesFile}
                  onFile={handleActivitiesFile}
                />
              </div>

              <div>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-2">
                  Période d&apos;analyse <span className="text-slate-500">(auto-détectée depuis le nom du fichier)</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Date de début", val: dateFrom, set: setDateFrom },
                    { label: "Date de fin",   val: dateTo,   set: setDateTo   },
                  ].map(({ label, val, set }) => (
                    <div key={label}>
                      <label className="text-xs text-slate-500 block mb-1">{label}</label>
                      <input
                        type="date"
                        value={val}
                        onChange={e => set(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm text-white"
                        style={{ background: "#1e293b", border: "1px solid #334155" }}
                      />
                    </div>
                  ))}
                </div>
                {dateFrom && dateTo && (
                  <p className="text-xs text-slate-500 mt-1">
                    → Les jours ouvrables seront calculés sur cette période exacte (fériés exclus).
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-2">
                  Rapport Nethris <span className="text-slate-500">(optionnel — active la comparaison)</span>
                </p>
                <UploadZone
                  label="Rapport Nethris"
                  hint="Types d'heures par jour (.csv ou .xlsx)"
                  file={nethrisFile}
                  onFile={setNethrisFile}
                  optional
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl p-4 mb-4 text-sm" style={{ background: "#450a0a", border: "1px solid #991b1b", color: "#fca5a5" }}>
                ❌ {error}
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={!activitiesFile || loading}
              className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: activitiesFile && !loading ? "#2563eb" : "#1e293b", border: "1px solid #3b82f6" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Analyse en cours…
                </span>
              ) : "🚀 Analyser"}
            </button>
          </div>
        )}

        {result && (
          <>
            <div className="flex justify-end mb-3">
              <button
                onClick={() => { setResult(null); setActivitiesFile(null); setNethrisFile(null); }}
                className="text-xs text-slate-400 hover:text-white px-3 py-1 rounded-lg border border-slate-600 hover:border-slate-400 transition-colors"
              >
                ↩ Nouveau fichier
              </button>
            </div>

            <KpiCards
              data={result}
              empFilter={empFilter}
              activeTab={activeTab}
              onTab={setActiveTab}
              hasNethris={hasNethris}
            />

            <div className="mt-2">
              {activeTab === "employees"  && <TabEmployees data={result} />}
              {activeTab === "resume"     && <TabResume    data={result} empFilter={empFilter} />}
              {activeTab === "occupation" && result.comparison && (
                <TabOccupation data={result.comparison} empFilter={empFilter} plannedSummaries={result.planned_summaries ?? undefined} />
              )}
              {activeTab === "logs"       && <TabLogs      data={result} empFilter={empFilter} />}
              {activeTab === "overtime"   && <TabOvertime  data={result} empFilter={empFilter} />}
              {activeTab === "absences"   && <TabAbsences  data={result} empFilter={empFilter} />}
            </div>

            {/* Contexte TCAP — événements et congés de la période pour croiser avec les trous de logs */}
            <TcapContextPanel dateFrom={dateFrom} dateTo={dateTo} />
          </>
        )}
      </main>
    </div>
  );
}
