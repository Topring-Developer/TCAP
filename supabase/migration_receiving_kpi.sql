-- ============================================================
-- Migration KPI Réception — TCAP
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- Flag : inclure l'employé dans le KPI réception (exclure bureau)
alter table employees
  add column if not exists include_in_receiving_kpi boolean not null default true;

create table if not exists receiving_daily_counts (
  id uuid primary key default gen_random_uuid(),
  external_key text not null,
  import_batch_id uuid null references import_batches(id),
  employee_id uuid null references employees(id),
  external_user_name text not null,
  doc_date date not null,
  period_month text not null,
  line_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint receiving_daily_counts_external_key_key unique (external_key)
);

create index if not exists idx_recv_daily_month on receiving_daily_counts(period_month);
create index if not exists idx_recv_daily_date on receiving_daily_counts(doc_date);
create index if not exists idx_recv_daily_employee on receiving_daily_counts(employee_id);
create index if not exists idx_recv_daily_user on receiving_daily_counts(external_user_name);

alter table receiving_daily_counts disable row level security;
