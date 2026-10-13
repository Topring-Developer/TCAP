-- ============================================================
-- Migration KPI Inventaire cyclique — TCAP
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

create table if not exists inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  import_batch_id uuid null references import_batches(id),
  employee_id uuid null references employees(id),
  external_user_code text null,
  external_user_name text not null,
  count_date date not null,
  period_month text not null,
  item_code text null,
  location text null,
  has_discrepancy boolean not null default false,
  created_at timestamptz not null default now(),
  constraint inventory_count_lines_external_id_key unique (external_id)
);

create index if not exists idx_inv_lines_month on inventory_count_lines(period_month);
create index if not exists idx_inv_lines_date on inventory_count_lines(count_date);
create index if not exists idx_inv_lines_employee on inventory_count_lines(employee_id);
create index if not exists idx_inv_lines_user on inventory_count_lines(external_user_name);

create table if not exists inventory_team_settings (
  id uuid primary key default gen_random_uuid(),
  lines_per_employee_per_month integer not null default 500,
  effective_from date not null default current_date,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists inv_settings_updated_at on inventory_team_settings;
create trigger inv_settings_updated_at before update on inventory_team_settings
  for each row execute function set_updated_at();

-- Objectif équipe par défaut
insert into inventory_team_settings (lines_per_employee_per_month, effective_from, notes)
select 500, '2026-01-01', 'Objectif équipe inventaire — lignes par employé par mois'
where not exists (select 1 from inventory_team_settings);

alter table inventory_count_lines disable row level security;
alter table inventory_team_settings disable row level security;
