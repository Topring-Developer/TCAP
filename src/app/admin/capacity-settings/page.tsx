"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CapacityThreshold } from "@/lib/supabase/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { WEEKDAY_LABELS } from "@/lib/utils";

export default function CapacitySettingsPage() {
  const supabase = createClient();
  const [thresholds, setThresholds] = useState<Record<number, number>>({
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("capacity_thresholds").select("*");
    if (data) {
      const map: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const t of (data as CapacityThreshold[])) map[t.weekday] = t.min_employees;
      setThresholds(map);
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    for (const [wd, min] of Object.entries(thresholds)) {
      await supabase
        .from("capacity_thresholds")
        .upsert({ weekday: Number(wd), min_employees: min })
        .eq("weekday", Number(wd));
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <PageHeader
        title="Seuil d'effectif"
        subtitle="Définir le nombre minimum d'employés requis par jour pour déclencher l'alerte Sous-effectif dans le calendrier de présence."
        actions={
          <Button onClick={handleSave} disabled={saving || loading}>
            <Save className="w-4 h-4" />
            {saving ? "Enregistrement…" : saved ? "Enregistré !" : "Enregistrer"}
          </Button>
        }
      />

      {loading ? (
        <div className="text-center py-12 text-slate-400">Chargement…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 text-sm text-slate-500">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            Un badge <span className="font-semibold text-red-600 mx-1">Sous-effectif</span> s&apos;affiche
            dans l&apos;en-tête du jour quand le nombre de présents est inférieur au seuil.
            Mettez <span className="font-semibold mx-1">0</span> pour désactiver l&apos;alerte ce jour-là.
          </div>

          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Jour
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Minimum d&apos;employés présents
                </th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">
                  Statut
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[1, 2, 3, 4, 5].map((day) => {
                const val = thresholds[day] ?? 0;
                return (
                  <tr key={day} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {WEEKDAY_LABELS[day]}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={val}
                          onChange={(e) => {
                            const n = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0));
                            setThresholds((p) => ({ ...p, [day]: n }));
                          }}
                          className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <span className="text-sm text-slate-400">employés minimum</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {val === 0 ? (
                        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                          Désactivé
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded-full font-medium">
                          Alerte si &lt; {val}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
