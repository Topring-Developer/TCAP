-- ============================================================
-- Migration KPI Emballage (Expédition) — TCAP
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- Agrégat journalier : 1 ligne = 1 employé × 1 jour
-- line_count / wave_count / picklist_count calculés à l'import depuis l'export SAP emballage
-- employee_id nullable : on importe aussi non mappés / aides / ex-employés
create table if not exists packaging_daily_counts (
  id uuid primary key default gen_random_uuid(),
  external_key text not null,
  import_batch_id uuid null references import_batches(id),
  employee_id uuid null references employees(id),
  external_user_code text null,
  external_user_name text not null,
  doc_date date not null,
  period_month text not null,
  line_count integer not null default 0,
  wave_count integer not null default 0,
  picklist_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint packaging_daily_counts_external_key_key unique (external_key)
);

create index if not exists idx_pack_daily_month on packaging_daily_counts(period_month);
create index if not exists idx_pack_daily_date on packaging_daily_counts(doc_date);
create index if not exists idx_pack_daily_employee on packaging_daily_counts(employee_id);
create index if not exists idx_pack_daily_user on packaging_daily_counts(external_user_name);

alter table packaging_daily_counts disable row level security;

-- TWMS : "Expédition" = temps emballage / tâches d'expédition
insert into task_mapping (s8_task_name, kpi_department, is_productive, is_direct_labor, include_in_kpi)
values ('Expédition', 'Expédition', true, true, true)
on conflict (s8_task_name) do update
  set kpi_department = 'Expédition',
      is_productive = true,
      is_direct_labor = true,
      include_in_kpi = true;
