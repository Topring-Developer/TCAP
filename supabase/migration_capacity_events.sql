-- ─────────────────────────────────────────────────────────────────────────────
-- Table unifiée des événements de capacité
-- Remplace employee_exclusions + employee_adjustments
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists capacity_events (
  id            uuid        primary key default gen_random_uuid(),
  employee_id   uuid        not null references employees(id) on delete cascade,
  event_type    text        not null
                constraint capacity_events_type_check
                check (event_type in (
                  'overtime',           -- +heures : OT / dépassement
                  'part_time_boost',    -- +heures : TP qui travaille en TF temporairement
                  'late',               -- -heures : retard
                  'early_departure',    -- -heures : départ hâtif
                  'planned_absence',    -- -heures : vacances, congé planifié (intersecté avec horaire)
                  'unplanned_absence'   -- -heures : maladie, urgence (intersecté avec horaire)
                )),
  start_datetime timestamptz not null,
  end_datetime   timestamptz not null,
  notes          text,
  created_at     timestamptz not null default now(),
  constraint capacity_events_dates_check check (end_datetime > start_datetime)
);

create index if not exists capacity_events_employee_idx on capacity_events(employee_id);
create index if not exists capacity_events_dates_idx    on capacity_events(start_datetime, end_datetime);

alter table capacity_events disable row level security;

comment on table capacity_events is
  'Événements de capacité unifiés (remplace employee_exclusions + employee_adjustments). '
  'Types positifs : overtime, part_time_boost. '
  'Types négatifs intersectés horaire : planned_absence, unplanned_absence. '
  'Types négatifs durée brute : late, early_departure.';

-- ─── Migration des données existantes ────────────────────────────────────────

-- Ajustements positifs kind=overtime → overtime
insert into capacity_events (id, employee_id, event_type, start_datetime, end_datetime, notes, created_at)
select gen_random_uuid(), employee_id, 'overtime', start_datetime, end_datetime, notes, created_at
from employee_adjustments
where direction = 'positive' and (kind = 'overtime' or kind is null);

-- Ajustements positifs kind=recovery → part_time_boost
insert into capacity_events (id, employee_id, event_type, start_datetime, end_datetime, notes, created_at)
select gen_random_uuid(), employee_id, 'part_time_boost', start_datetime, end_datetime, notes, created_at
from employee_adjustments
where direction = 'positive' and kind = 'recovery';

-- Ajustements négatifs → late
insert into capacity_events (id, employee_id, event_type, start_datetime, end_datetime, notes, created_at)
select gen_random_uuid(), employee_id, 'late', start_datetime, end_datetime, notes, created_at
from employee_adjustments
where direction = 'negative';

-- Exclusions → planned_absence (toutes les exclusions existantes considérées planifiées)
insert into capacity_events (id, employee_id, event_type, start_datetime, end_datetime, notes, created_at)
select gen_random_uuid(), employee_id, 'planned_absence', start_datetime, end_datetime, notes, created_at
from employee_exclusions;
