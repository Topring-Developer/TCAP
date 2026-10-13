-- ============================================================
-- Migration KPI Production — temps standard vs temps réel
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- Contrainte unique sur item_code pour upsert des standards
create unique index if not exists idx_production_standards_item_code
  on production_standards (item_code)
  where is_active = true;

-- Table production réelle (import Excel BOM/Item/Qty/Temps)
create table if not exists production_actuals (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references import_batches(id),
  bom_number text null,
  item_code text not null,
  item_code_matched text null,
  series text not null,
  quantity numeric(12,4) not null default 0,
  actual_minutes numeric(12,2) not null default 0,
  standard_minutes_per_unit numeric(10,4) null,
  actual_minutes_per_unit numeric(12,4) null,
  target_minutes numeric(12,2) null,
  ratio numeric(12,4) null,
  period_month text not null,
  last_updated_at timestamptz null,
  included_in_kpi boolean not null default true,
  exclusion_reason text null check (
    exclusion_reason is null or exclusion_reason in (
      'ok', 'standard_manquant', 'trop_lent', 'trop_rapide', 'quantite_zero', 'temps_zero'
    )
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_prod_actuals_month on production_actuals(period_month);
create index if not exists idx_prod_actuals_series on production_actuals(series);
create index if not exists idx_prod_actuals_item on production_actuals(item_code);
create index if not exists idx_prod_actuals_batch on production_actuals(import_batch_id);
create index if not exists idx_prod_actuals_kpi on production_actuals(included_in_kpi);

alter table production_actuals disable row level security;
