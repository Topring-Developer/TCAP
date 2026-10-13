"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus, Pencil, Trash2, Filter, TrendingUp, TrendingDown,
  Clock, CalendarOff, Stethoscope,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import type {
  Employee,
  CapacityEvent,
  CapacityEventInsert,
  CapacityEventType,
  CapacityEventWithEmployee,
  EmployeeLeave,
  EmployeeLeaveInsert,
  NethrisAbsenceReasonId,
} from "@/lib/supabase/types";
import {
  CAPACITY_EVENT_LABELS,
  CAPACITY_EVENT_POSITIVE_TYPES,
} from "@/lib/supabase/types";
import {
  LEAVE_REASON_LABELS,
  NETHRIS_ABSENCE_REASONS,
  getEventDisplayLabel,
} from "@/lib/capacity";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

// ─── Constantes ───────────────────────────────────────────────────────────────

type Tab = "events" | "leaves";

const EVENT_TYPE_ICONS: Record<CapacityEventType, React.ElementType> = {
  overtime:          TrendingUp,
  part_time_boost:   TrendingUp,
  late:              Clock,
  early_departure:   Clock,
  planned_absence:   CalendarOff,
  unplanned_absence: Stethoscope,
};

const EVENT_TYPE_COLORS: Record<CapacityEventType, string> = {
  overtime:          "bg-blue-50 text-blue-700 border-blue-200",
  part_time_boost:   "bg-purple-50 text-purple-700 border-purple-200",
  late:              "bg-orange-50 text-orange-700 border-orange-200",
  early_departure:   "bg-orange-50 text-orange-700 border-orange-200",
  planned_absence:   "bg-slate-100 text-slate-600 border-slate-200",
  unplanned_absence: "bg-red-50 text-red-700 border-red-200",
};

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function formatDatetimeFr(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy HH:mm", { locale: fr });
}

function getDurationLabel(start: string, end: string): string {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function isPositive(type: CapacityEventType): boolean {
  return CAPACITY_EVENT_POSITIVE_TYPES.includes(type);
}

// ─── Types formulaire ─────────────────────────────────────────────────────────

type EventFormState = {
  employee_id: string;
  event_type: CapacityEventType | "";
  nethris_reason_id: NethrisAbsenceReasonId | null;
  fullDay: boolean;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  notes: string;
};

const TIMING_TYPES = ["late", "early_departure"] as const;

type LeaveFormState = {
  employee_id: string;
  reason: "medical" | "injury" | "mental" | "personal" | "other";
  start_date: string;
  end_date: string;
  notes: string;
};

const EMPTY_EVENT_FORM: EventFormState = {
  employee_id: "",
  event_type: "",
  nethris_reason_id: null,
  fullDay: true,
  start_date: new Date().toISOString().slice(0, 10),
  start_time: "08:00",
  end_date: new Date().toISOString().slice(0, 10),
  end_time: "17:00",
  notes: "",
};

const EMPTY_LEAVE_FORM: LeaveFormState = {
  employee_id: "",
  reason: "medical",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  notes: "",
};

// ─── Composant principal ──────────────────────────────────────────────────────

export default function EventsPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("events");

  // ─── État Événements ───────────────────────────────────────────────────
  const [events, setEvents] = useState<CapacityEventWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterDate, setFilterDate] = useState("");

  const [eventModal, setEventModal] = useState<{
    open: boolean;
    editing: CapacityEventWithEmployee | null;
  }>({ open: false, editing: null });
  const [eventForm, setEventForm] = useState<EventFormState>(EMPTY_EVENT_FORM);
  const [savingEvent, setSavingEvent] = useState(false);
  const [deleteEventConfirm, setDeleteEventConfirm] = useState<string | null>(null);

  // ─── État Congés prolongés ─────────────────────────────────────────────
  const [leaves, setLeaves] = useState<(EmployeeLeave & { employees: Pick<Employee, "id" | "full_name"> })[]>([]);
  const [loadingLeaves, setLoadingLeaves] = useState(true);

  const [leaveFilterEmployee, setLeaveFilterEmployee] = useState("");
  const [leaveFilterActive, setLeaveFilterActive] = useState<"" | "active" | "past">("");

  const [leaveModal, setLeaveModal] = useState<{
    open: boolean;
    editing: (EmployeeLeave & { employees: Pick<Employee, "id" | "full_name"> }) | null;
  }>({ open: false, editing: null });
  const [leaveForm, setLeaveForm] = useState<LeaveFormState>(EMPTY_LEAVE_FORM);
  const [savingLeave, setSavingLeave] = useState(false);
  const [deleteLeaveConfirm, setDeleteLeaveConfirm] = useState<string | null>(null);

  // ─── Chargement ───────────────────────────────────────────────────────

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase.from("employees").select("*").eq("is_active", true).order("full_name");
    setEmployees(data ?? []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    const { data } = await supabase
      .from("capacity_events")
      .select("*, employees(id, full_name)")
      .order("start_datetime", { ascending: false });
    setEvents((data as CapacityEventWithEmployee[]) ?? []);
    setLoadingEvents(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLeaves = useCallback(async () => {
    setLoadingLeaves(true);
    const { data } = await supabase
      .from("employee_leaves")
      .select("*, employees(id, full_name)")
      .order("start_date", { ascending: false });
    setLeaves((data as (EmployeeLeave & { employees: Pick<Employee, "id" | "full_name"> })[]) ?? []);
    setLoadingLeaves(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadEmployees();
    loadEvents();
    loadLeaves();
  }, [loadEmployees, loadEvents, loadLeaves]);

  // ─── Filtres Événements ───────────────────────────────────────────────

  const filteredEvents = events.filter((ev) => {
    if (filterEmployee && ev.employee_id !== filterEmployee) return false;
    if (filterType) {
      if (filterType.startsWith("reason:")) {
        if (ev.nethris_reason_id !== filterType.slice("reason:".length)) return false;
      } else if (ev.event_type !== filterType) {
        return false;
      }
    }
    if (filterDate) {
      const d = filterDate;
      const s = ev.start_datetime.slice(0, 10);
      const e = ev.end_datetime.slice(0, 10);
      if (d < s || d > e) return false;
    }
    return true;
  });

  // ─── Filtres Congés ───────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const filteredLeaves = leaves.filter((lv) => {
    if (leaveFilterEmployee && lv.employee_id !== leaveFilterEmployee) return false;
    if (leaveFilterActive === "active") {
      if (lv.end_date && lv.end_date < today) return false;
    }
    if (leaveFilterActive === "past") {
      if (!lv.end_date || lv.end_date >= today) return false;
    }
    return true;
  });

  // ─── CRUD Événements ──────────────────────────────────────────────────

  function openCreateEvent() {
    setEventForm(EMPTY_EVENT_FORM);
    setEventModal({ open: true, editing: null });
  }

  function openEditEvent(ev: CapacityEventWithEmployee) {
    const start = parseISO(ev.start_datetime);
    const end   = parseISO(ev.end_datetime);
    const isFullDay =
      start.getHours() === 0 && start.getMinutes() === 0 &&
      end.getHours() >= 23;
    setEventForm({
      employee_id: ev.employee_id,
      event_type: ev.event_type,
      nethris_reason_id: ev.nethris_reason_id ?? null,
      fullDay: isFullDay,
      start_date: ev.start_datetime.slice(0, 10),
      start_time: isFullDay ? "08:00" : format(start, "HH:mm"),
      end_date: ev.end_datetime.slice(0, 10),
      end_time: isFullDay ? "17:00" : format(end, "HH:mm"),
      notes: ev.notes ?? "",
    });
    setEventModal({ open: true, editing: ev });
  }

  function buildEventDatetimes(): { start: string; end: string } {
    if (eventForm.fullDay) {
      return {
        start: new Date(eventForm.start_date + "T00:00:00").toISOString(),
        end:   new Date(eventForm.end_date   + "T23:59:59").toISOString(),
      };
    }
    return {
      start: new Date(eventForm.start_date + "T" + eventForm.start_time).toISOString(),
      end:   new Date(eventForm.end_date   + "T" + eventForm.end_time).toISOString(),
    };
  }

  async function handleSaveEvent() {
    if (!eventForm.employee_id || !eventForm.event_type) return;
    const isTiming = TIMING_TYPES.includes(eventForm.event_type as typeof TIMING_TYPES[number]);
    const isPositiveType = CAPACITY_EVENT_POSITIVE_TYPES.includes(eventForm.event_type);
    const isBankAbsence = !isTiming && !isPositiveType;
    if (isBankAbsence && !eventForm.nethris_reason_id) return;

    setSavingEvent(true);
    const { start, end } = buildEventDatetimes();
    const payload: CapacityEventInsert = {
      employee_id: eventForm.employee_id,
      event_type:  eventForm.event_type,
      nethris_reason_id: isBankAbsence ? eventForm.nethris_reason_id : null,
      start_datetime: start,
      end_datetime:   end,
      notes: eventForm.notes.trim() || null,
    };
    if (eventModal.editing) {
      await supabase.from("capacity_events").update(payload).eq("id", eventModal.editing.id);
    } else {
      await supabase.from("capacity_events").insert(payload);
    }
    setSavingEvent(false);
    setEventModal({ open: false, editing: null });
    loadEvents();
  }

  async function handleDeleteEvent(id: string) {
    await supabase.from("capacity_events").delete().eq("id", id);
    setDeleteEventConfirm(null);
    loadEvents();
  }

  // ─── CRUD Congés ──────────────────────────────────────────────────────

  function openCreateLeave() {
    setLeaveForm(EMPTY_LEAVE_FORM);
    setLeaveModal({ open: true, editing: null });
  }

  function openEditLeave(lv: EmployeeLeave & { employees: Pick<Employee, "id" | "full_name"> }) {
    setLeaveForm({
      employee_id: lv.employee_id,
      reason: lv.reason,
      start_date: lv.start_date,
      end_date: lv.end_date ?? "",
      notes: lv.notes ?? "",
    });
    setLeaveModal({ open: true, editing: lv });
  }

  async function handleSaveLeave() {
    if (!leaveForm.employee_id || !leaveForm.start_date) return;
    setSavingLeave(true);
    const payload: EmployeeLeaveInsert = {
      employee_id: leaveForm.employee_id,
      reason: leaveForm.reason,
      start_date: leaveForm.start_date,
      end_date: leaveForm.end_date || null,
      notes: leaveForm.notes.trim() || null,
    };
    if (leaveModal.editing) {
      await supabase.from("employee_leaves").update(payload).eq("id", leaveModal.editing.id);
    } else {
      await supabase.from("employee_leaves").insert(payload);
    }
    setSavingLeave(false);
    setLeaveModal({ open: false, editing: null });
    loadLeaves();
  }

  async function handleDeleteLeave(id: string) {
    await supabase.from("employee_leaves").delete().eq("id", id);
    setDeleteLeaveConfirm(null);
    loadLeaves();
  }

  // ─── Rendu ───────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Événements de capacité"
        subtitle="Gestion unifiée des absences, overtime, retards et congés prolongés"
        actions={
          <Button onClick={tab === "events" ? openCreateEvent : openCreateLeave}>
            <Plus className="w-4 h-4" />
            {tab === "events" ? "Ajouter un événement" : "Ajouter un congé"}
          </Button>
        }
      />

      {/* Onglets */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {(["events", "leaves"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-slate-800 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {t === "events" ? (
              <span className="flex items-center gap-2">
                Événements
                {!loadingEvents && (
                  <span className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                    {events.length}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Congés prolongés
                {!loadingLeaves && leaves.filter((l) => !l.end_date || l.end_date >= today).length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
                    {leaves.filter((l) => !l.end_date || l.end_date >= today).length} actif{leaves.filter((l) => !l.end_date || l.end_date >= today).length > 1 ? "s" : ""}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Onglet Événements ─────────────────────────────────────────── */}
      {tab === "events" && (
        <>
          {/* Filtres */}
          <div className="flex flex-wrap gap-3 mb-5 p-4 bg-white rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Filter className="w-4 h-4" /> Filtres
            </div>

            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
            >
              <option value="">Tous les employés</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
            >
              <option value="">Tous les types</option>
              <optgroup label="Positifs">
                <option value="overtime">Overtime</option>
                <option value="part_time_boost">Boost temps partiel</option>
              </optgroup>
              <optgroup label="Absences">
                {NETHRIS_ABSENCE_REASONS.map((r) => (
                  <option key={r.id} value={`reason:${r.id}`}>{r.supervisor_label}</option>
                ))}
              </optgroup>
              <optgroup label="Timing">
                <option value="late">Retard</option>
                <option value="early_departure">Départ hâtif</option>
              </optgroup>
            </select>

            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
            />

            {(filterEmployee || filterType || filterDate) && (
              <Button variant="ghost" size="sm" onClick={() => { setFilterEmployee(""); setFilterType(""); setFilterDate(""); }}>
                Réinitialiser
              </Button>
            )}
          </div>

          {/* Table événements */}
          {loadingEvents ? (
            <div className="text-center py-12 text-slate-400">Chargement…</div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-12 text-slate-400">Aucun événement</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">Employé</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Impact</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Début</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Fin</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Durée</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Note</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEvents.map((ev) => {
                    const pos = isPositive(ev.event_type);
                    const Icon = EVENT_TYPE_ICONS[ev.event_type];
                    return (
                      <tr key={ev.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-900">{ev.employees?.full_name}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
                            EVENT_TYPE_COLORS[ev.event_type]
                          )}>
                            <Icon className="w-3 h-3" />
                            {getEventDisplayLabel(ev)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "text-xs font-bold",
                            pos ? "text-blue-600" : "text-red-500"
                          )}>
                            {pos ? "+" : "−"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDatetimeFr(ev.start_datetime)}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDatetimeFr(ev.end_datetime)}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{getDurationLabel(ev.start_datetime, ev.end_datetime)}</td>
                        <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{ev.notes ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => openEditEvent(ev)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {deleteEventConfirm === ev.id ? (
                              <div className="flex items-center gap-1">
                                <Button variant="danger" size="sm" onClick={() => handleDeleteEvent(ev.id)}>Oui</Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleteEventConfirm(null)}>Non</Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => setDeleteEventConfirm(ev.id)}
                                className="text-red-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── Onglet Congés prolongés ───────────────────────────────────── */}
      {tab === "leaves" && (
        <>
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <strong>Congé prolongé</strong> — L&apos;employé est exclu des compteurs de présence, des alertes de sous-effectif
            et des calculs de KPI pendant toute la période. Il n&apos;apparaît pas dans le calendrier de capacité.
          </div>

          {/* Filtres */}
          <div className="flex flex-wrap gap-3 mb-5 p-4 bg-white rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Filter className="w-4 h-4" /> Filtres
            </div>

            <select
              value={leaveFilterEmployee}
              onChange={(e) => setLeaveFilterEmployee(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
            >
              <option value="">Tous les employés</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>

            <select
              value={leaveFilterActive}
              onChange={(e) => setLeaveFilterActive(e.target.value as "" | "active" | "past")}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700"
            >
              <option value="">Tous</option>
              <option value="active">En cours / à venir</option>
              <option value="past">Terminés</option>
            </select>

            {(leaveFilterEmployee || leaveFilterActive) && (
              <Button variant="ghost" size="sm" onClick={() => { setLeaveFilterEmployee(""); setLeaveFilterActive(""); }}>
                Réinitialiser
              </Button>
            )}
          </div>

          {/* Table congés */}
          {loadingLeaves ? (
            <div className="text-center py-12 text-slate-400">Chargement…</div>
          ) : filteredLeaves.length === 0 ? (
            <div className="text-center py-12 text-slate-400">Aucun congé prolongé</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">Employé</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Raison</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Statut</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Début</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Fin prévue</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Note</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLeaves.map((lv) => {
                    const isActive = !lv.end_date || lv.end_date >= today;
                    return (
                      <tr key={lv.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-900">{lv.employees?.full_name}</td>
                        <td className="px-4 py-3 text-slate-700">{LEAVE_REASON_LABELS[lv.reason] ?? lv.reason}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                            isActive
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-slate-100 text-slate-500"
                          )}>
                            {isActive ? "En cours" : "Terminé"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{lv.start_date}</td>
                        <td className="px-4 py-3 text-slate-600">{lv.end_date ?? <span className="text-slate-400 italic">à définir</span>}</td>
                        <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{lv.notes ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => openEditLeave(lv)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {deleteLeaveConfirm === lv.id ? (
                              <div className="flex items-center gap-1">
                                <Button variant="danger" size="sm" onClick={() => handleDeleteLeave(lv.id)}>Oui</Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleteLeaveConfirm(null)}>Non</Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => setDeleteLeaveConfirm(lv.id)}
                                className="text-red-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── Modal Événement ───────────────────────────────────────────── */}
      <Modal
        open={eventModal.open}
        onClose={() => setEventModal({ open: false, editing: null })}
        title={eventModal.editing ? "Modifier l'événement" : "Ajouter un événement"}
        size="md"
      >
        <div className="space-y-4">
          {/* Employé */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Employé</label>
            <select
              value={eventForm.employee_id}
              onChange={(e) => setEventForm((p) => ({ ...p, employee_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— Sélectionner —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {/* Type d'événement */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Type d&apos;événement</label>
            <div className="grid grid-cols-2 gap-2">
              {/* Positifs */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Positifs
                </p>
                {(["overtime", "part_time_boost"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEventForm((p) => ({ ...p, event_type: t, nethris_reason_id: null }))}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg border-2 text-sm transition-colors",
                      eventForm.event_type === t && !eventForm.nethris_reason_id
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {CAPACITY_EVENT_LABELS[t]}
                  </button>
                ))}
              </div>
              {/* Absences */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Absences
                </p>
                {NETHRIS_ABSENCE_REASONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setEventForm((p) => ({
                      ...p,
                      event_type: r.event_type,
                      nethris_reason_id: r.id,
                      fullDay: true,
                    }))}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg border-2 text-sm transition-colors",
                      eventForm.nethris_reason_id === r.id
                        ? "border-red-400 bg-red-50 text-red-800"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {r.supervisor_label}
                  </button>
                ))}
                {TIMING_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEventForm((p) => ({
                      ...p,
                      event_type: t,
                      nethris_reason_id: null,
                      fullDay: false,
                    }))}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg border-2 text-sm transition-colors",
                      eventForm.event_type === t && !eventForm.nethris_reason_id
                        ? "border-red-400 bg-red-50 text-red-800"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {CAPACITY_EVENT_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Durée */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Durée</p>
            <div className="flex gap-3 mb-3">
              {[true, false].map((fd) => (
                <label key={String(fd)} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={eventForm.fullDay === fd}
                    onChange={() => setEventForm((p) => ({ ...p, fullDay: fd }))}
                    className="accent-slate-800"
                  />
                  <span className="text-sm text-slate-700">{fd ? "Journée(s) complète(s)" : "Plage horaire précise"}</span>
                </label>
              ))}
            </div>

            {eventForm.fullDay ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Date début</label>
                  <input
                    type="date"
                    value={eventForm.start_date}
                    onChange={(e) => setEventForm((p) => ({ ...p, start_date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Date fin</label>
                  <input
                    type="date"
                    value={eventForm.end_date}
                    onChange={(e) => setEventForm((p) => ({ ...p, end_date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Date + heure début</label>
                  <input type="date" value={eventForm.start_date}
                    onChange={(e) => setEventForm((p) => ({ ...p, start_date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-primary" />
                  <input type="time" value={eventForm.start_time}
                    onChange={(e) => setEventForm((p) => ({ ...p, start_time: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Date + heure fin</label>
                  <input type="date" value={eventForm.end_date}
                    onChange={(e) => setEventForm((p) => ({ ...p, end_date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-primary" />
                  <input type="time" value={eventForm.end_time}
                    onChange={(e) => setEventForm((p) => ({ ...p, end_time: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              </div>
            )}
          </div>

          {/* Note */}
          <Input
            label="Note (optionnel)"
            value={eventForm.notes}
            onChange={(e) => setEventForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Ex: Rendez-vous médical, livraison urgente…"
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setEventModal({ open: false, editing: null })}>Annuler</Button>
            <Button
              onClick={handleSaveEvent}
              disabled={
                savingEvent ||
                !eventForm.employee_id ||
                !eventForm.event_type ||
                !eventForm.start_date ||
                !eventForm.end_date ||
                (
                  !CAPACITY_EVENT_POSITIVE_TYPES.includes(eventForm.event_type as CapacityEventType) &&
                  !TIMING_TYPES.includes(eventForm.event_type as typeof TIMING_TYPES[number]) &&
                  !eventForm.nethris_reason_id
                )
              }
            >
              {savingEvent ? "Enregistrement…" : eventModal.editing ? "Enregistrer" : "Ajouter"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Modal Congé prolongé ──────────────────────────────────────── */}
      <Modal
        open={leaveModal.open}
        onClose={() => setLeaveModal({ open: false, editing: null })}
        title={leaveModal.editing ? "Modifier le congé prolongé" : "Ajouter un congé prolongé"}
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            L&apos;employé sera exclu des calculs de capacité et de KPI pendant toute la période.
          </div>

          {/* Employé */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Employé</label>
            <select
              value={leaveForm.employee_id}
              onChange={(e) => setLeaveForm((p) => ({ ...p, employee_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— Sélectionner —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {/* Raison */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Raison</label>
            <select
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value as LeaveFormState["reason"] }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Object.entries(LEAVE_REASON_LABELS).map(([v, lbl]) => (
                <option key={v} value={v}>{lbl}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Date de début</label>
              <input
                type="date"
                value={leaveForm.start_date}
                onChange={(e) => setLeaveForm((p) => ({ ...p, start_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">
                Date de retour <span className="text-slate-400">(optionnel)</span>
              </label>
              <input
                type="date"
                value={leaveForm.end_date}
                onChange={(e) => setLeaveForm((p) => ({ ...p, end_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <Input
            label="Note (optionnel)"
            value={leaveForm.notes}
            onChange={(e) => setLeaveForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Ex: CNESST, médecin de famille, dépression…"
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setLeaveModal({ open: false, editing: null })}>Annuler</Button>
            <Button
              onClick={handleSaveLeave}
              disabled={savingLeave || !leaveForm.employee_id || !leaveForm.start_date}
            >
              {savingLeave ? "Enregistrement…" : leaveModal.editing ? "Enregistrer" : "Ajouter"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
