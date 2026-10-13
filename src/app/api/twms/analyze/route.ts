/**
 * API Route TWMS — Version TCAP (Supabase)
 *
 * Différences vs l'ancienne version standalone :
 *  1. Les horaires ne sont plus hardcodés : ils proviennent de Supabase
 *     (tables employees + employee_system_mapping + employee_work_schedule)
 *  2. Les jours fériés ne sont plus hardcodés : ils proviennent de Supabase
 *     (table public_holidays)
 *  3. La fonction analyzeAll() accepte `shifts` et `feries` en paramètres
 *  4. Le handler POST charge les deux depuis Supabase en parallèle
 *
 * Schéma Supabase utilisé :
 *
 *   employees               : id, is_active, employment_type ("full_time"|"part_time"|"suivi")
 *   employee_system_mapping : employee_id, system_name ("S8"), external_employee_name
 *   employee_work_schedule  : employee_id, weekday (1=Lun..5=Ven), am_start (HH:MM), pm_end (HH:MM)
 *   public_holidays         : id, date (YYYY-MM-DD)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";


import { classifyActivity, CATEGORY_LABELS } from "./classify";
import { aggregateNethrisRows, type NethrisDay } from "./nethris";

// ── Types internes ─────────────────────────────────────────────────────────────

interface ShiftInfo {
  type: "TempsPlein" | "Suivi" | "Partiel";
  prenom: string;
  nom: string;
  startH?: number; startM?: number;
  endH?: number;   endM?: number;
  // Jours à exclure (convention JS getDay : 0=dim, 1=lun, 2=mar … 6=sam)
  skipDays?: number[];
  // Fin de quart personnalisée le vendredi (remplace la règle FRI_FINISH_MIN)
  fridayEndH?: number; fridayEndM?: number;
  // Fenêtre d'emploi — null/undefined = pas de borne
  hiredAt?: string;       // YYYY-MM-DD
  deactivatedAt?: string; // YYYY-MM-DD
}

interface Activity {
  emp_key: string;
  prenom: string;
  nom: string;
  activity: string;
  start: Date;
  end: Date;
  dur_min: number;
  date: string;
  weekday: number;
  week: number;
  year: number;
}

// ── Paramètres d'analyse ───────────────────────────────────────────────────────

const PAUSE_CFG = {
  cafe_am: { label: "Café AM",  startH: 9,  startM: 45, endH: 11, endM: 10, expected: 10, min_ok: 8,  max_ok: 25 },
  diner:   { label: "Dîner",    startH: 11, startM: 30, endH: 13, endM: 30, expected: 60, min_ok: 25, max_ok: 90 },
  cafe_pm: { label: "Café PM",  startH: 14, startM: 45, endH: 16, endM:  0, expected: 10, min_ok: 8,  max_ok: 25 },
} as const;

const GAP_MIN        = 5;
const MICRO_SEC      = 30;
const WEEK_NORM_HRS  = 39.5;
const FRI_FINISH_MIN = 30;
const LATE_MIN       = 15;
const EARLY_MIN      = 15;
const PAUSE_BUFFER   = 10;
const PAUSE_TOL      = 2;

// ── Utilitaires ────────────────────────────────────────────────────────────────

function decodeHtml(s: string): string {
  return s
    .replace(/&eacute;/gi,  "é").replace(/&Eacute;/gi,  "É")
    .replace(/&egrave;/gi,  "è").replace(/&Egrave;/gi,  "È")
    .replace(/&ecirc;/gi,   "ê").replace(/&Ecirc;/gi,   "Ê")
    .replace(/&agrave;/gi,  "à").replace(/&Agrave;/gi,  "À")
    .replace(/&acirc;/gi,   "â").replace(/&Acirc;/gi,   "Â")
    .replace(/&icirc;/gi,   "î").replace(/&Icirc;/gi,   "Î")
    .replace(/&ocirc;/gi,   "ô").replace(/&Ocirc;/gi,   "Ô")
    .replace(/&ucirc;/gi,   "û").replace(/&Ucirc;/gi,   "Û")
    .replace(/&ccedil;/gi,  "ç").replace(/&Ccedil;/gi,  "Ç")
    .replace(/&iuml;/gi,    "ï").replace(/&euml;/gi,    "ë")
    .replace(/&uuml;/gi,    "ü").replace(/&oelig;/gi,   "œ")
    .replace(/&aelig;/gi,   "æ").replace(/&amp;/gi,     "&")
    .replace(/&quot;/gi,    '"').replace(/&apos;/gi,    "'");
}

function key(prenom: string, nom: string): string {
  const clean = (x: string) => decodeHtml(x.trim().replace(/^(nan|None)$/, ""));
  return `${clean(prenom)} ${clean(nom)}`.trim();
}

function isoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function addMin(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000);
}

function toDateMins(h: number, m: number): number { return h * 60 + m; }

function shiftEnd(info: ShiftInfo, weekday: number): { endH: number; endM: number } {
  if (weekday === 4 && info.fridayEndH !== undefined) {
    return { endH: info.fridayEndH, endM: info.fridayEndM! };
  }
  let endMins = toDateMins(info.endH!, info.endM!);
  if (weekday === 4) endMins -= FRI_FINISH_MIN;
  return { endH: Math.floor(endMins / 60), endM: endMins % 60 };
}

function pauseApplies(pw: { startH: number; startM: number; expected: number }, shiftEndH: number, shiftEndM: number): boolean {
  const cutoffMins = toDateMins(pw.startH, pw.startM) + pw.expected + PAUSE_BUFFER;
  return toDateMins(shiftEndH, shiftEndM) >= cutoffMins;
}

function netExpected(startH: number, startM: number, endH: number, endM: number): number {
  const gross = toDateMins(endH, endM) - toDateMins(startH, startM);
  const deduct = Object.values(PAUSE_CFG).reduce((s, pw) =>
    s + (pauseApplies(pw, endH, endM) ? pw.expected : 0), 0);
  return gross - deduct;
}

function businessDays(from: Date, to: Date, feries: Set<string>): string[] {
  const days: string[] = [];
  const fromStr = from.toISOString().slice(0, 10);
  const toStr   = to.toISOString().slice(0, 10);
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));
  while (cur <= end) {
    const wd = cur.getUTCDay();
    const ds = cur.toISOString().slice(0, 10);
    if (wd !== 0 && wd !== 6 && !feries.has(ds)) days.push(ds);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

const WEEKDAY_FR = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

// ── Chargement depuis Supabase ─────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Charge les horaires des employés depuis Supabase.
 *
 * Tables consultées :
 *   - employees (is_active = true, employment_type)
 *   - employee_system_mapping (system_name = "S8", external_employee_name = clé TWMS)
 *   - employee_work_schedule (weekday 1-5, am_start, pm_end)
 */
async function loadShiftsFromSupabase(): Promise<Record<string, ShiftInfo>> {
  const supabase = getSupabase();

  const { data: emps, error } = await supabase
    .from("employees")
    .select(`
      id,
      employment_type,
      hired_at,
      deactivated_at,
      employee_system_mapping(system_name, external_employee_name),
      employee_work_schedule(weekday, am_start, pm_end)
    `);

  if (error || !emps) {
    console.error("[TWMS] loadShifts Supabase error:", error?.message);
    return {};
  }

  const shifts: Record<string, ShiftInfo> = {};

  for (const emp of emps) {
    // Trouver le mapping TWMS (système "S8")
    const mappings = (emp.employee_system_mapping ?? []) as Array<{
      system_name: string;
      external_employee_name: string;
    }>;
    // system_name = "S8" dans TCAP correspond aux logs TWMS
    const s8 = mappings.find(m => m.system_name === "S8");
    if (!s8?.external_employee_name) continue;
    const twmsKey = s8.external_employee_name.trim();

    // Mapper employment_type → type interne
    // Valeurs TCAP : "full_time" | "part_time" | "suivi"
    const rawType: string = emp.employment_type ?? "";
    const type: ShiftInfo["type"] =
      rawType === "full_time" ? "TempsPlein" :
      rawType === "suivi"     ? "Suivi"      : "Partiel";

    const schedules = (emp.employee_work_schedule ?? []) as Array<{
      weekday: number;              // 1=Lun .. 5=Ven
      am_start: string | null;      // "HH:MM" ou null = jour non travaillé
      pm_end:   string | null;
    }>;

    const hasHours = (s: { am_start: string | null; pm_end: string | null }) =>
      Boolean(s.am_start && s.pm_end);

    // Jours sans heures (ligne absente OU am_start/pm_end null) → skip
    // JS getDay() : 1=Lun .. 5=Ven (même que TCAP weekday)
    const workdays = new Set(
      schedules.filter(s => s.weekday >= 1 && s.weekday <= 5 && hasHours(s)).map(s => s.weekday)
    );
    const skipDays: number[] = [];
    for (let d = 1; d <= 5; d++) {
      if (!workdays.has(d)) skipDays.push(d);
    }

    const parts = twmsKey.split(" ");
    const info: ShiftInfo = {
      type,
      prenom: parts[0] ?? twmsKey,
      nom:    parts.slice(1).join(" "),
    };
    if (skipDays.length) info.skipDays = skipDays;
    if (emp.hired_at)       info.hiredAt       = (emp.hired_at as string).slice(0, 10);
    if (emp.deactivated_at) info.deactivatedAt = (emp.deactivated_at as string).slice(0, 10);

    // Horaire de référence : premier jour AVEC heures (pas un lundi vide)
    const sorted = [...schedules]
      .filter(s => s.weekday >= 1 && s.weekday <= 5 && hasHours(s))
      .sort((a, b) => a.weekday - b.weekday);
    const base = sorted[0];

    // Supabase retourne les colonnes time au format "HH:MM:SS" — on prend HH et MM
    if (base && type !== "Partiel" && base.am_start && base.pm_end) {
      const [sh, sm] = base.am_start.split(":").map(Number);
      const [eh, em] = base.pm_end.split(":").map(Number);
      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
        info.startH = sh; info.startM = sm;
        info.endH   = eh; info.endM   = em;
      }
    }

    // Fin vendredi personnalisée : si elle diffère de la règle globale -30 min
    const fri = sorted.find(s => s.weekday === 5);
    if (fri?.pm_end && info.endH !== undefined && info.endM !== undefined) {
      const defaultFriEnd = toDateMins(info.endH, info.endM) - FRI_FINISH_MIN;
      const [fh, fm] = fri.pm_end.split(":").map(Number);
      if (!isNaN(fh) && !isNaN(fm)) {
        const actualFriEnd = toDateMins(fh, fm);
        if (actualFriEnd !== defaultFriEnd) {
          info.fridayEndH = fh;
          info.fridayEndM = fm;
        }
      }
    }

    shifts[twmsKey] = info;
  }

  return shifts;
}

/**
 * Charge les jours fériés depuis Supabase.
 * Table : public_holidays, colonne : date (YYYY-MM-DD)
 */
async function loadFeriesFromSupabase(): Promise<Set<string>> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("public_holidays")
    .select("date");

  if (error || !data) {
    console.error("[TWMS] loadFeries Supabase error:", error?.message);
    return new Set();
  }

  return new Set(data.map((r: { date: string }) => r.date.slice(0, 10)));
}

// ── Chargement CSV TWMS ────────────────────────────────────────────────────────

function loadActivities(csv: string): Activity[] {
  const { data } = Papa.parse<Record<string, string>>(csv, {
    header: true, skipEmptyLines: true, delimiter: ";",
  });
  const rows: Activity[] = [];
  for (const r of data) {
    const prenom   = (r["Prénom"] ?? "").trim();
    const nom      = (r["Nom"] ?? "").trim();
    const activity = (r["Nom de l'activité"] ?? "").trim();
    const dateStr2 = (r["Date"] ?? "").trim();
    const debut    = (r["Début"] ?? "").trim();
    const fin      = (r["Fin"] ?? "").trim();
    if (!dateStr2 || !debut || !fin) continue;
    const start = new Date(`${dateStr2} ${debut}`);
    const end   = new Date(`${dateStr2} ${fin}`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    const dur_min = (end.getTime() - start.getTime()) / 60000;
    const wd = start.getDay() === 0 ? 6 : start.getDay() - 1; // 0=Lundi, 4=Vendredi
    rows.push({
      emp_key: key(prenom, nom),
      prenom, nom, activity,
      start, end, dur_min,
      date: dateStr(start),
      weekday: wd,
      week: isoWeek(start),
      year: start.getFullYear(),
    });
  }
  return rows;
}

// ── Résumé planifié vs Nethris ─────────────────────────────────────────────────

interface EmpPlannedSummary {
  emp_key:       string;
  working_days:  number;
  planned_hrs:   number;
  nethris_hrs:   number;
  nethris_days:  number;
  gap_hrs:       number;
  approved_days: number;
  sick_days:     number;
}

function dailyPlannedHrs(info: ShiftInfo, weekdayMon0: number): number {
  const startMins = toDateMins(info.startH!, info.startM!);
  let endMins: number;
  if (weekdayMon0 === 4) {
    endMins = info.fridayEndH !== undefined
      ? toDateMins(info.fridayEndH, info.fridayEndM!)
      : toDateMins(info.endH!, info.endM!) - FRI_FINISH_MIN;
  } else {
    endMins = toDateMins(info.endH!, info.endM!);
  }
  return (endMins - startMins) / 60;
}

interface NethrisPresence {
  employees:   Set<string>;
  workingDays: Map<string, Set<string>>;
}

function buildNethrisPresence(nethrisDays: NethrisDay[]): NethrisPresence {
  const employees   = new Set<string>();
  const workingDays = new Map<string, Set<string>>();
  for (const d of nethrisDays) {
    employees.add(d.twmsKey);
    if (d.hresReg > 0) {
      if (!workingDays.has(d.twmsKey)) workingDays.set(d.twmsKey, new Set());
      workingDays.get(d.twmsKey)!.add(d.date);
    }
  }
  return { employees, workingDays };
}

// ── Analyse principale ─────────────────────────────────────────────────────────

function analyzeAll(
  activitiesCsv: string,
  shifts:        Record<string, ShiftInfo>,
  feries:        Set<string>,
  nethrisDays?:  NethrisDay[],
  dateFrom?:     string,
  dateTo?:       string,
) {
  const activities = loadActivities(activitiesCsv);

  const ftEmps = new Set(
    Object.entries(shifts)
      .filter(([, v]) => v.type === "TempsPlein" && v.startH !== undefined)
      .map(([k]) => k)
  );
  const suiviEmps = new Set(
    Object.entries(shifts)
      .filter(([, v]) => v.type === "Suivi" && v.startH !== undefined)
      .map(([k]) => k)
  );
  const analyzedEmps = new Set([...ftEmps, ...suiviEmps]);

  // Grouper par (emp_key, date) pour les employés analysés
  const grouped: Record<string, Activity[]> = {};
  for (const a of activities) {
    if (!analyzedEmps.has(a.emp_key)) continue;
    const gk = `${a.emp_key}||${a.date}`;
    if (!grouped[gk]) grouped[gk] = [];
    grouped[gk].push(a);
  }

  const dailyRecords: Record<string, unknown>[] = [];
  const anomalies:    Record<string, unknown>[] = [];

  for (const [gk, rows] of Object.entries(grouped)) {
    const [empKey, dayStr2] = gk.split("||");
    const info = shifts[empKey];
    if (!info || info.type === "Partiel") continue;

    const sortedRows = [...rows].sort((a, b) => a.start.getTime() - b.start.getTime());
    const dt  = new Date(dayStr2 + "T12:00:00");
    const wd  = sortedRows[0].weekday; // 0=lun, 4=ven

    const firstLog = sortedRows[0].start;
    const lastLog  = sortedRows[sortedRows.length - 1].end;
    const lastLogMins = toDateMins(lastLog.getHours(), lastLog.getMinutes());

    // Bornes de quart
    const ss  = new Date(dayStr2 + `T${String(info.startH!).padStart(2,"0")}:${String(info.startM!).padStart(2,"0")}:00`);
    const { endH, endM } = shiftEnd(info, wd);
    const se  = new Date(dayStr2 + `T${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}:00`);

    let workLogged = 0;
    let pauseLogged = 0;
    let beforeShift = 0;
    let afterShift  = 0;
    let dinnerWorked = 0;
    const gaps: { from_dt: string; to_dt: string; gap_min: number; from_act: string; to_act: string }[] = [];
    let errCount = 0;

    const addAnom = (type: string, sev: string, desc: string, durMin = 0, time?: string) => {
      anomalies.push({ emp_key: empKey, prenom: info.prenom, nom: info.nom, date: dayStr2, time, type, severity: sev, description: desc, duration_min: Math.round(durMin * 10) / 10 });
      errCount++;
    };

    // Trous entre activités
    for (let i = 0; i < sortedRows.length - 1; i++) {
      const cur  = sortedRows[i];
      const next = sortedRows[i + 1];
      if (cur.dur_min < MICRO_SEC / 60) continue;
      const gapMin = (next.start.getTime() - cur.end.getTime()) / 60000;
      if (gapMin >= GAP_MIN) {
        gaps.push({
          from_dt:  cur.end.toISOString(),
          to_dt:    next.start.toISOString(),
          gap_min:  Math.round(gapMin * 10) / 10,
          from_act: cur.activity,
          to_act:   next.activity,
        });
        addAnom("Trou non loggé", "Moyenne", `${Math.round(gapMin)} min non loggées entre « ${cur.activity} » et « ${next.activity} »`, gapMin, hhmm(cur.end));
      }
    }

    for (const r of sortedRows) {
      if (r.activity === "Pause") { pauseLogged += r.dur_min; continue; }
      const startMins = r.start.getHours() * 60 + r.start.getMinutes();
      const endMins2  = r.end.getHours()   * 60 + r.end.getMinutes();
      const ssM = toDateMins(info.startH!, info.startM!);
      const seM = toDateMins(endH, endM);
      if (endMins2 <= ssM)        beforeShift  += r.dur_min;
      else if (startMins >= seM)  afterShift   += r.dur_min;
      else {
        const clampedStart = Math.max(startMins, ssM);
        const clampedEnd   = Math.min(endMins2,  seM);
        workLogged += Math.max(0, clampedEnd - clampedStart);
        const lunchS = 11 * 60 + 30;
        const lunchE = 13 * 60 + 30;
        if (r.activity !== "Pause" && startMins < lunchE && endMins2 > lunchS) {
          dinnerWorked += Math.min(endMins2, lunchE) - Math.max(startMins, lunchS);
        }
      }
    }

    // Retard / départ anticipé
    const ssDate = addMin(ss, 0);
    const seDate = addMin(se, 0);
    const lateRaw  = (firstLog.getTime() - ssDate.getTime()) / 60000;
    const earlyRaw = (seDate.getTime()   - lastLog.getTime()) / 60000;
    const late     = lateRaw  > LATE_MIN  ? lateRaw  : 0;
    const isFriShortEnd = wd === 4 && lastLogMins >= 14 * 60 + 40 && lastLogMins <= 15 * 60 + 20;
    const early    = (!isFriShortEnd && earlyRaw > EARLY_MIN) ? earlyRaw : 0;

    if (late  > 0) addAnom("Arrivée tardive",  "Élevée",  `Arrivée à ${hhmm(firstLog)} — ${Math.round(late)} min de retard`, late,  hhmm(firstLog));
    if (early > 0) addAnom("Départ anticipé",  "Moyenne", `Départ à ${hhmm(lastLog)} — ${Math.round(early)} min avant la fin du quart`, early, hhmm(lastLog));

    // Pauses
    const pauseResult: Record<string, { min: number | null; flag: string; label: string }> = {};
    for (const [pwKey, pw] of Object.entries(PAUSE_CFG)) {
      if (!pauseApplies(pw, endH, endM)) {
        pauseResult[pwKey] = { min: null, flag: "N/A", label: pw.label };
        continue;
      }
      const pauseCutoffMins = toDateMins(pw.startH, pw.startM) + pw.expected + PAUSE_BUFFER;
      if (lastLogMins < pauseCutoffMins) {
        pauseResult[pwKey] = { min: null, flag: "N/A", label: pw.label };
        continue;
      }
      const winStart = addMin(new Date(dayStr2 + `T${String(pw.startH).padStart(2,"0")}:${String(pw.startM).padStart(2,"0")}:00`), 0);
      const winEnd   = addMin(new Date(dayStr2 + `T${String(pw.endH).padStart(2,"0")}:${String(pw.endM).padStart(2,"0")}:00`), 0);
      let total = 0;
      for (const r of sortedRows) {
        if (r.activity !== "Pause") continue;
        const ov = Math.min(r.end.getTime(), winEnd.getTime()) - Math.max(r.start.getTime(), winStart.getTime());
        if (ov > 0) total += ov / 60000;
      }
      let flag = "OK";
      const effectiveTotal = total < 2 ? 0 : total;
      if (effectiveTotal === 0)                         flag = "Absente";
      else if (effectiveTotal < pw.min_ok - PAUSE_TOL) flag = "Trop courte";
      else if (effectiveTotal > pw.max_ok + PAUSE_TOL) flag = "Trop longue";

      if (flag !== "OK" && flag !== "N/A") {
        addAnom(
          `Pause ${pw.label}`,
          flag === "Absente" ? "Élevée" : "Moyenne",
          flag === "Absente"
            ? `Pause ${pw.label} absente`
            : `Pause ${pw.label} ${flag.toLowerCase()} : ${Math.round(total)} min`,
          total,
          undefined
        );
      }
      pauseResult[pwKey] = { min: total > 0 ? Math.round(total * 10) / 10 : null, flag, label: pw.label };
    }

    const netExp = netExpected(info.startH!, info.startM!, endH, endM);
    const covPct = netExp > 0 ? Math.round((workLogged / netExp) * 1000) / 10 : 0;

    dailyRecords.push({
      emp_key: empKey, prenom: info.prenom, nom: info.nom,
      date: dayStr2, weekday: wd, week: sortedRows[0].week, year: sortedRows[0].year,
      week_label: `Sem. ${sortedRows[0].week}/${sortedRows[0].year}`,
      shift_start: `${String(info.startH!).padStart(2,"0")}:${String(info.startM!).padStart(2,"0")}`,
      shift_end:   `${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}`,
      net_expected_min:  Math.round(netExp * 10) / 10,
      first_log:  firstLog.toISOString(),
      last_log:   lastLog.toISOString(),
      work_logged_min:   Math.round(workLogged * 10) / 10,
      pause_logged_min:  Math.round(pauseLogged * 10) / 10,
      coverage_pct:      covPct,
      total_gaps_min:    gaps.reduce((s, g) => s + g.gap_min, 0),
      gap_count:         gaps.length,
      late_arrival_min:  Math.round(late * 10) / 10,
      early_dep_min:     Math.round(early * 10) / 10,
      before_shift_min:  Math.round(beforeShift * 10) / 10,
      after_shift_min:   Math.round(afterShift * 10) / 10,
      dinner_worked_min: Math.round(dinnerWorked * 10) / 10,
      error_count:       errCount,
      n_activities:      sortedRows.length,
      gaps,
      pauses: pauseResult,
    });
  }

  // ── Semaines ─────────────────────────────────────────────────────────────────
  const wkMap: Record<string, {
    emp_key: string; prenom: string; nom: string; week_label: string; week: number; year: number;
    days: number; work_min: number; gap_min: number; gap_n: number; err_n: number;
    cov_sum: number; before_min: number; after_min: number; din_w: number; late_n: number; early_n: number;
  }> = {};

  for (const r of dailyRecords) {
    const wk2 = `${r.emp_key}||${r.week_label}`;
    if (!wkMap[wk2]) {
      wkMap[wk2] = {
        emp_key: r.emp_key as string, prenom: r.prenom as string, nom: r.nom as string,
        week_label: r.week_label as string, week: r.week as number, year: r.year as number,
        days: 0, work_min: 0, gap_min: 0, gap_n: 0, err_n: 0, cov_sum: 0,
        before_min: 0, after_min: 0, din_w: 0, late_n: 0, early_n: 0,
      };
    }
    const w = wkMap[wk2];
    w.days++;
    w.work_min   += r.work_logged_min  as number;
    w.gap_min    += r.total_gaps_min   as number;
    w.gap_n      += r.gap_count        as number;
    w.err_n      += r.error_count      as number;
    w.cov_sum    += r.coverage_pct     as number;
    w.before_min += r.before_shift_min as number;
    w.after_min  += r.after_shift_min  as number;
    w.din_w      += r.dinner_worked_min as number;
    if ((r.late_arrival_min as number) > 0)  w.late_n++;
    if ((r.early_dep_min    as number) > 0) w.early_n++;
  }

  const weekly = Object.values(wkMap).map(w => {
    const otMin = Math.max(0, w.work_min - WEEK_NORM_HRS * 60);
    return {
      ...w,
      hors_quart_min: Math.round((w.before_min + w.after_min) * 10) / 10,
      overtime_min:   Math.round(otMin * 10) / 10,
      work_hrs:       Math.round(w.work_min / 60 * 100) / 100,
      overtime_hrs:   Math.round(otMin / 60 * 100) / 100,
      cov_avg:        Math.round(w.cov_sum / w.days * 10) / 10,
    };
  });

  // ── Absences ─────────────────────────────────────────────────────────────────
  const allDates = [...new Set(activities.map(a => a.date))].sort();
  const minDate  = dateFrom ?? allDates[0];
  const maxDate  = dateTo   ?? allDates[allDates.length - 1];
  const bdays    = businessDays(new Date(minDate), new Date(maxDate), feries);

  const presence: Record<string, Set<string>> = {};
  for (const a of activities) {
    if (!ftEmps.has(a.emp_key)) continue;
    if (!presence[a.emp_key]) presence[a.emp_key] = new Set();
    presence[a.emp_key].add(a.date);
  }

  const nethrisPresence = nethrisDays ? buildNethrisPresence(nethrisDays) : null;

  const absences: Record<string, unknown>[] = [];
  for (const empKey of [...ftEmps].sort()) {
    const logged = presence[empKey] ?? new Set<string>();
    const info   = shifts[empKey];

    const inNethris    = nethrisPresence?.employees.has(empKey) ?? false;
    const nethrisWork  = nethrisPresence?.workingDays.get(empKey);
    const hasNoNethrisHours = inNethris && (!nethrisWork || nethrisWork.size === 0);

    for (const d of bdays) {
      const dt  = new Date(d + "T12:00:00");
      const wd  = dt.getDay();
      if (info.skipDays?.includes(wd)) continue;
      // Ne pas signaler une absence avant la date d'embauche ou après la désactivation
      if (info.hiredAt       && d < info.hiredAt)       continue;
      if (info.deactivatedAt && d > info.deactivatedAt) continue;

      if (!logged.has(d)) {
        const wkn = isoWeek(dt);
        let absType = "Journée absente";
        let severity = "Info";
        let description = `Aucun log ce ${WEEKDAY_FR[wd]}`;

        if (nethrisPresence) {
          if (hasNoNethrisHours) {
            absType     = "Congé maladie / longue durée";
            severity    = "Info";
            description = `Absent · aucune heure Nethris sur la période`;
          } else if (inNethris && !nethrisWork?.has(d)) {
            absType     = "Congé approuvé";
            severity    = "Info";
            description = `Absent · journée sans heure Nethris (congé, vacances...)`;
          }
        }

        absences.push({
          emp_key: empKey, prenom: info.prenom, nom: info.nom,
          date: d, weekday: wd, weekday_name: WEEKDAY_FR[wd],
          week: wkn, week_label: `Sem. ${wkn}/${dt.getFullYear()}`,
          absence_type: absType,
        });
        if (absType === "Journée absente") {
          anomalies.push({
            emp_key: empKey, prenom: info.prenom, nom: info.nom,
            date: d, type: "Journée absente", severity,
            description, duration_min: 0,
          });
        }
      }
    }
  }

  // ── Allocation par activité ───────────────────────────────────────────────────
  const allocMap: Record<string, { total_min: number }> = {};
  for (const a of activities) {
    if (!ftEmps.has(a.emp_key) || a.activity === "Pause") continue;
    const wkn = `${a.activity}||Sem. ${a.week}/${a.year}`;
    if (!allocMap[wkn]) allocMap[wkn] = { total_min: 0 };
    allocMap[wkn].total_min += a.dur_min;
  }
  const allocation = Object.entries(allocMap).map(([k, v]) => {
    const [act, week_label] = k.split("||");
    return { "Nom de l'activité": act, week_label, total_min: Math.round(v.total_min * 10) / 10, total_hrs: Math.round(v.total_min / 60 * 100) / 100 };
  });

  // ── Résumé planifié vs Nethris ────────────────────────────────────────────────
  let planned_summaries: EmpPlannedSummary[] | null = null;
  if (nethrisDays && nethrisDays.length > 0) {
    const nethrisTotals: Record<string, { hrs: number; days: number }> = {};
    for (const d of nethrisDays) {
      if (!nethrisTotals[d.twmsKey]) nethrisTotals[d.twmsKey] = { hrs: 0, days: 0 };
      nethrisTotals[d.twmsKey].hrs  += d.hresReg;
      nethrisTotals[d.twmsKey].days += 1;
    }
    const approvedCount: Record<string, number> = {};
    const sickCount:     Record<string, number> = {};
    for (const a of absences) {
      const emp  = a.emp_key  as string;
      const type = a.absence_type as string;
      if (type === "Congé approuvé")               approvedCount[emp] = (approvedCount[emp] || 0) + 1;
      if (type === "Congé maladie / longue durée") sickCount[emp]     = (sickCount[emp]     || 0) + 1;
    }
    planned_summaries = [...ftEmps].sort().map(empKey => {
      const info = shifts[empKey];
      let plannedHrs = 0;
      for (const d of bdays) {
        const dt    = new Date(d + "T12:00:00");
        const dayJS = dt.getDay();
        if (info.skipDays?.includes(dayJS)) continue;
        if (info.hiredAt       && d < info.hiredAt)       continue;
        if (info.deactivatedAt && d > info.deactivatedAt) continue;
        const wd = dayJS === 0 ? 6 : dayJS - 1;
        plannedHrs += dailyPlannedHrs(info, wd);
      }
      const nethris    = nethrisTotals[empKey] ?? { hrs: 0, days: 0 };
      const planned    = Math.round(plannedHrs * 100) / 100;
      const nethrisHrs = Math.round(nethris.hrs * 100) / 100;
      return {
        emp_key:       empKey,
        working_days:  bdays.length,
        planned_hrs:   planned,
        nethris_hrs:   nethrisHrs,
        nethris_days:  nethris.days,
        gap_hrs:       Math.round((nethrisHrs - planned) * 100) / 100,
        approved_days: approvedCount[empKey] || 0,
        sick_days:     sickCount[empKey]     || 0,
      };
    });
  }

  const allTwmsEmps = [...new Set(activities.map(a => a.emp_key))].sort();

  return {
    daily:    dailyRecords,
    weekly,
    anomalies,
    absences,
    allocation,
    ft_emps:       [...ftEmps].sort(),
    suivi_emps:    [...suiviEmps].sort(),
    all_twms_emps: allTwmsEmps,
    period:   `${minDate} au ${maxDate}`,
    planned_summaries,
  };
}

// ── Comparaison Nethris × TWMS ────────────────────────────────────────────────

interface ComparisonDay {
  emp_key:            string;
  date:               string;
  nethris_hrs:        number;
  productive_min:     number;
  non_prod_min:       number;
  pause_paid_min:     number;
  lunch_min:          number;
  abnormal_min:       number;
  unknown_min:        number;
  total_logged_min:   number;
  twms_billed_min:    number;
  gap_vs_nethris_min: number;
  occupation_rate:    number;
  non_conforme_min:   number;
  activities: { name: string; category: string; label: string; dur_min: number; start: string }[];
}

function buildComparison(
  activities: Activity[],
  nethrisDays: NethrisDay[]
): ComparisonDay[] {
  const nethrisMap = new Map<string, NethrisDay>();
  for (const d of nethrisDays) nethrisMap.set(`${d.twmsKey}||${d.date}`, d);

  const grouped: Record<string, Activity[]> = {};
  for (const a of activities) {
    const mk = `${a.emp_key}||${a.date}`;
    if (!grouped[mk]) grouped[mk] = [];
    grouped[mk].push(a);
  }

  const result: ComparisonDay[] = [];

  for (const [mk, rows] of Object.entries(grouped)) {
    const nd = nethrisMap.get(mk);
    if (!nd || nd.hresReg <= 0) continue;

    let prodMin = 0, nonProdMin = 0, pausePaidMin = 0, lunchMin = 0, abnormalMin = 0, unknownMin = 0;
    const actList: ComparisonDay["activities"] = [];

    for (const a of rows) {
      const cat = classifyActivity(a.activity, a.start, a.dur_min);
      switch (cat) {
        case "productive":     prodMin     += a.dur_min; break;
        case "non_productive": nonProdMin  += a.dur_min; break;
        case "pause_paid":     pausePaidMin+= a.dur_min; break;
        case "lunch":          lunchMin    += a.dur_min; break;
        case "pause_abnormal": abnormalMin += a.dur_min; break;
        case "unknown":        unknownMin  += a.dur_min; break;
      }
      actList.push({
        name:     a.activity,
        category: cat,
        label:    CATEGORY_LABELS[cat],
        dur_min:  Math.round(a.dur_min * 10) / 10,
        start:    hhmm(a.start),
      });
    }

    const nethrisMins    = nd.hresReg * 60;
    const occupiedMins   = prodMin + nonProdMin;
    const billedMins     = prodMin + nonProdMin + pausePaidMin;
    const occRate        = nethrisMins > 0 ? Math.round((occupiedMins / nethrisMins) * 1000) / 10 : 0;
    const nonConf        = Math.max(0, nethrisMins - occupiedMins - pausePaidMin - abnormalMin - unknownMin);
    const gapVsNethris   = Math.round((billedMins - nethrisMins) * 10) / 10;

    result.push({
      emp_key:            nd.twmsKey,
      date:               nd.date,
      nethris_hrs:        nd.hresReg,
      productive_min:     Math.round(prodMin * 10) / 10,
      non_prod_min:       Math.round(nonProdMin * 10) / 10,
      pause_paid_min:     Math.round(pausePaidMin * 10) / 10,
      lunch_min:          Math.round(lunchMin * 10) / 10,
      abnormal_min:       Math.round(abnormalMin * 10) / 10,
      unknown_min:        Math.round(unknownMin * 10) / 10,
      total_logged_min:   Math.round((prodMin + nonProdMin + pausePaidMin + lunchMin + abnormalMin + unknownMin) * 10) / 10,
      twms_billed_min:    Math.round(billedMins * 10) / 10,
      gap_vs_nethris_min: gapVsNethris,
      occupation_rate:    occRate,
      non_conforme_min:   Math.round(nonConf * 10) / 10,
      activities:         actList.sort((a, b) => a.start.localeCompare(b.start)),
    });
  }

  return result.sort((a, b) => a.emp_key.localeCompare(b.emp_key) || a.date.localeCompare(b.date));
}

// ── Handler HTTP ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { activitiesCsv, nethrisRows, dateFrom, dateTo } = await req.json() as {
      activitiesCsv: string;
      nethrisRows?:  Array<{ nom: string; date: string; type: string; hours: number }>;
      dateFrom?:     string;
      dateTo?:       string;
    };

    if (!activitiesCsv) {
      return NextResponse.json({ error: "Le fichier activities est requis" }, { status: 400 });
    }

    // Charger shifts et fériés depuis Supabase en parallèle
    const [shifts, feries] = await Promise.all([
      loadShiftsFromSupabase(),
      loadFeriesFromSupabase(),
    ]);

    let nethrisDays: NethrisDay[] | undefined;
    if (nethrisRows && nethrisRows.length > 0) {
      nethrisDays = aggregateNethrisRows(nethrisRows);
    }

    const twmsResult = analyzeAll(activitiesCsv, shifts, feries, nethrisDays, dateFrom, dateTo);

    let comparison: ComparisonDay[] | null = null;
    if (nethrisDays && nethrisDays.length > 0) {
      const ftEmpSet   = new Set(twmsResult.ft_emps);
      const activities = loadActivities(activitiesCsv).filter(a => ftEmpSet.has(a.emp_key));
      const comp = buildComparison(activities, nethrisDays);
      comparison = comp.length > 0 ? comp : null;
    }

    return NextResponse.json({ ...twmsResult, comparison });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[twms/analyze] ERREUR:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
