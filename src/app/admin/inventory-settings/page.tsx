"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Setting = {
  id: string;
  lines_per_employee_per_month: number;
  effective_from: string;
  notes: string | null;
};

export default function InventorySettingsPage() {
  const supabase = createClient();
  const [current, setCurrent] = useState<Setting | null>(null);
  const [goal, setGoal] = useState("500");
  const [effectiveFrom, setEffectiveFrom] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("inventory_team_settings")
      .select("*")
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setCurrent(data as Setting);
      setGoal(String(data.lines_per_employee_per_month));
      setEffectiveFrom(data.effective_from);
      setNotes(data.notes ?? "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    const n = parseInt(goal, 10);
    if (isNaN(n) || n <= 0) return;
    setSaving(true);
    setSaved(false);

    if (current) {
      await supabase
        .from("inventory_team_settings")
        .update({
          lines_per_employee_per_month: n,
          effective_from: effectiveFrom,
          notes: notes || null,
        })
        .eq("id", current.id);
    } else {
      await supabase.from("inventory_team_settings").insert({
        lines_per_employee_per_month: n,
        effective_from: effectiveFrom,
        notes: notes || null,
      });
    }

    setSaving(false);
    setSaved(true);
    load();
  }

  return (
    <div className="p-8 max-w-lg mx-auto">
      <PageHeader
        title="Objectif — Inventaire"
        subtitle="Nombre de lignes de décompte attendu par employé et par mois (équipe entière)"
      />

      {loading ? (
        <p className="text-slate-400">Chargement…</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-3 p-4 bg-teal-50 border border-teal-100 rounded-xl">
            <Target className="w-8 h-8 text-teal-600" />
            <div>
              <p className="text-sm text-teal-800 font-medium">Objectif équipe actuel</p>
              <p className="text-2xl font-bold text-teal-900">
                {current?.lines_per_employee_per_month ?? 500} lignes / employé / mois
              </p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">
              Lignes par employé par mois
            </label>
            <Input
              type="number"
              min={1}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">
              En vigueur à partir du
            </label>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">
              Notes (optionnel)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex. objectif Q2 2026"
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>

          {saved && (
            <p className="text-sm text-green-600">Objectif enregistré.</p>
          )}
        </div>
      )}
    </div>
  );
}
