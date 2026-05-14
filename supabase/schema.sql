-- ============================================================
-- Dashboard Capacité Employés — Schéma Supabase
-- À exécuter dans l'éditeur SQL de Supabase
-- ============================================================

-- 1. Employés
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Horaires normaux (lundi–vendredi)
create table if not exists employee_work_schedule (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 5),
  am_start time null,
  am_end time null,
  pm_start time null,
  pm_end time null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, weekday),
  constraint am_pair check (
    (am_start is null and am_end is null) or
    (am_start is not null and am_end is not null and am_start < am_end)
  ),
  constraint pm_pair check (
    (pm_start is null and pm_end is null) or
    (pm_start is not null and pm_end is not null and pm_start < pm_end)
  )
);

-- 3. Types d'exclusion
create table if not exists exclusion_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  color text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Valeurs initiales
insert into exclusion_types (code, label, color) values
  ('VAC',   'Vacances',         '#3b82f6'),
  ('MAL',   'Maladie',          '#ef4444'),
  ('RDV',   'Rendez-vous',      '#f59e0b'),
  ('CONGE', 'Congé',            '#8b5cf6'),
  ('AUTRE', 'Autre',            '#6b7280')
on conflict (code) do nothing;

-- 4. Exclusions
create table if not exists employee_exclusions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  exclusion_type_id uuid not null references exclusion_types(id),
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  notes text null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_datetime > start_datetime)
);

-- 5. Ajustements
create table if not exists employee_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  direction text not null check (direction in ('positive', 'negative')),
  notes text null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_datetime > start_datetime)
);

-- ─── Index ────────────────────────────────────────────────────────────────────
create index if not exists idx_schedule_employee on employee_work_schedule(employee_id);
create index if not exists idx_exclusions_employee on employee_exclusions(employee_id);
create index if not exists idx_exclusions_dates on employee_exclusions(start_datetime, end_datetime);
create index if not exists idx_adjustments_employee on employee_adjustments(employee_id);
create index if not exists idx_adjustments_dates on employee_adjustments(start_datetime, end_datetime);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_updated_at before update on employees
  for each row execute function set_updated_at();

create trigger schedule_updated_at before update on employee_work_schedule
  for each row execute function set_updated_at();

create trigger exclusions_updated_at before update on employee_exclusions
  for each row execute function set_updated_at();

create trigger adjustments_updated_at before update on employee_adjustments
  for each row execute function set_updated_at();

-- ─── RLS (Row Level Security) — désactivé par défaut, à activer selon besoins ─
-- alter table employees enable row level security;
-- alter table employee_work_schedule enable row level security;
-- alter table exclusion_types enable row level security;
-- alter table employee_exclusions enable row level security;
-- alter table employee_adjustments enable row level security;
