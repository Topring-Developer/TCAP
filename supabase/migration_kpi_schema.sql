-- ============================================================
-- Migration KPI — TCAP Phase 2
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- ─── 1. Correspondance employés entre systèmes ───────────────
create table if not exists employee_system_mapping (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  system_name text not null,           -- 'S8', 'SAP', 'NETHRIS'
  external_employee_code text null,    -- code système externe
  external_employee_name text null,    -- nom tel qu'il apparaît dans le système
  is_active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, system_name)
);

-- ─── 2. Mapping des tâches S8 → départements KPI ─────────────
create table if not exists task_mapping (
  id uuid primary key default gen_random_uuid(),
  s8_task_name text not null unique,
  kpi_department text null,    -- 'Picking','Expédition','Réception','Production','Inventaire','Support'
  kpi_category text null,      -- sous-catégorie libre
  is_productive boolean not null default true,
  is_direct_labor boolean not null default true,
  include_in_kpi boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Valeurs initiales task_mapping
insert into task_mapping (s8_task_name, kpi_department, is_productive, is_direct_labor, include_in_kpi) values
  ('Expédition',                          'Expédition',  true,  true,  true),
  ('Réception',                           'Réception',   true,  true,  true),
  ('Picking',                             'Picking',     true,  true,  true),
  ('Production 901 - Boyaux & Dévidoirs', 'Production',  true,  true,  true),
  ('Production 902 - Cartes',             'Production',  true,  true,  true),
  ('Production 912-920-930',              'Production',  true,  true,  true),
  ('RMA-Emballage-Étiquetage',            'Expédition',  true,  true,  true),
  ('Gestion inventaire',                  'Inventaire',  true,  true,  false),
  ('Gestion',                             'Support',     false, false, false),
  ('Nettoyer, pelleter, balai, mouvement mobilier', 'Support', false, false, false),
  ('Tests, essais, entretien préventif',  'Support',     false, false, false),
  ('Réparation / Inspection',             'Support',     false, false, false),
  ('Contrôle de qualité (CQ)',            'Support',     false, true,  false),
  ('Tutorat',                             'Support',     false, false, false),
  ('Kaizen - 5 S',                        'Support',     false, false, false),
  ('Production non-codé / modification produits', 'Production', true, true, true),
  ('Meeting',                             'Support',     false, false, false)
on conflict (s8_task_name) do nothing;

-- ─── 3. Calendrier des semaines ──────────────────────────────
create table if not exists calendar_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null unique,
  week_end_date date not null,
  year integer not null,
  week_number integer not null,
  month integer not null,
  quarter integer not null,
  label text not null,    -- ex: "2026-W01"
  created_at timestamptz not null default now()
);

-- ─── 4. Suivi des imports ─────────────────────────────────────
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null,     -- 'S8_TIME_LOGS','S8_PRODUCTION','SAP_PICKING','SAP_PACKING','SAP_RECEIPTS','SAP_PRERECEPTIONS','PRODUCTION_STANDARDS'
  source_system text not null,   -- 'S8', 'SAP'
  period_start date not null,
  period_end date not null,
  imported_by text null,
  imported_at timestamptz not null default now(),
  file_name text null,
  row_count integer null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  notes text null,
  created_at timestamptz not null default now()
);

-- ─── 5. Logs de temps S8 ─────────────────────────────────────
create table if not exists s8_time_logs (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references import_batches(id),
  employee_id uuid null references employees(id),     -- null si non mappé
  external_employee_name text not null,
  task_name text not null,
  task_mapping_id uuid null references task_mapping(id),
  log_date date not null,
  start_time time null,
  end_time time null,
  duration_minutes numeric(8,2) not null default 0,
  validation_status text not null default 'pending' check (validation_status in ('pending','validated','rejected')),
  notes text null,
  created_at timestamptz not null default now()
);

-- ─── 6. Lignes opérationnelles SAP ───────────────────────────
create table if not exists sap_activity_lines (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references import_batches(id),
  employee_id uuid null references employees(id),
  external_employee_code text null,
  activity_type text not null check (activity_type in ('PICKING','PACKING','SHIPPING','RECEIVING')),
  activity_date date not null,
  document_number text null,
  line_number text null,
  item_code text null,
  quantity numeric(12,4) null,
  created_at timestamptz not null default now()
);

-- ─── 7. Production réelle S8 ─────────────────────────────────
create table if not exists s8_production_actuals (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references import_batches(id),
  employee_id uuid null references employees(id),
  external_employee_name text not null,
  production_date date not null,
  production_order text null,
  item_code text not null,
  quantity_produced numeric(12,4) not null default 0,
  actual_minutes numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ─── 8. Standards de production ──────────────────────────────
create table if not exists production_standards (
  id uuid primary key default gen_random_uuid(),
  item_code text not null,
  item_description text null,
  standard_minutes_per_unit numeric(10,4) not null,
  setup_minutes numeric(10,2) not null default 0,
  effective_date date not null default current_date,
  is_active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── 9. Pré-réceptions SAP ───────────────────────────────────
create table if not exists sap_prereceptions (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid null references import_batches(id),
  prereception_number text not null,
  supplier_code text null,
  supplier_name text null,
  employee_id uuid null references employees(id),
  start_datetime timestamptz null,
  close_datetime timestamptz null,
  status text null,
  line_count integer null,
  created_at timestamptz not null default now()
);

-- ─── Index ────────────────────────────────────────────────────
create index if not exists idx_s8_logs_employee      on s8_time_logs(employee_id);
create index if not exists idx_s8_logs_date          on s8_time_logs(log_date);
create index if not exists idx_s8_logs_task          on s8_time_logs(task_mapping_id);
create index if not exists idx_s8_logs_batch         on s8_time_logs(import_batch_id);
create index if not exists idx_sap_lines_employee    on sap_activity_lines(employee_id);
create index if not exists idx_sap_lines_date        on sap_activity_lines(activity_date);
create index if not exists idx_sap_lines_type        on sap_activity_lines(activity_type);
create index if not exists idx_s8_prod_employee      on s8_production_actuals(employee_id);
create index if not exists idx_s8_prod_date          on s8_production_actuals(production_date);
create index if not exists idx_prod_std_item         on production_standards(item_code, effective_date);
create index if not exists idx_mapping_system        on employee_system_mapping(system_name, external_employee_name);

-- ─── updated_at triggers ──────────────────────────────────────
create trigger esm_updated_at before update on employee_system_mapping
  for each row execute function set_updated_at();
create trigger tm_updated_at before update on task_mapping
  for each row execute function set_updated_at();
create trigger ps_updated_at before update on production_standards
  for each row execute function set_updated_at();

-- ─── Vues KPI ─────────────────────────────────────────────────

-- Vue: KPI picking par employé par semaine
create or replace view vw_kpi_picking_week as
select
  cw.week_start_date,
  cw.label as week_label,
  e.id as employee_id,
  e.full_name,
  count(distinct sal.id) as sap_lines,
  coalesce(sum(stl.duration_minutes) / 60.0, 0) as s8_hours,
  case when coalesce(sum(stl.duration_minutes), 0) > 0
    then round(count(distinct sal.id) / (sum(stl.duration_minutes) / 60.0), 2)
    else null
  end as lines_per_hour
from calendar_weeks cw
cross join employees e
left join sap_activity_lines sal
  on sal.employee_id = e.id
  and sal.activity_type = 'PICKING'
  and sal.activity_date between cw.week_start_date and cw.week_end_date
left join s8_time_logs stl
  on stl.employee_id = e.id
  and stl.log_date between cw.week_start_date and cw.week_end_date
  and stl.task_mapping_id in (select id from task_mapping where kpi_department = 'Picking' and include_in_kpi = true)
  and stl.validation_status = 'validated'
where e.is_active = true
group by cw.week_start_date, cw.label, e.id, e.full_name;

-- Vue: KPI expédition (emballage) par employé par semaine
create or replace view vw_kpi_packing_week as
select
  cw.week_start_date,
  cw.label as week_label,
  e.id as employee_id,
  e.full_name,
  count(distinct sal.id) as sap_lines,
  coalesce(sum(stl.duration_minutes) / 60.0, 0) as s8_hours,
  case when coalesce(sum(stl.duration_minutes), 0) > 0
    then round(count(distinct sal.id) / (sum(stl.duration_minutes) / 60.0), 2)
    else null
  end as lines_per_hour
from calendar_weeks cw
cross join employees e
left join sap_activity_lines sal
  on sal.employee_id = e.id
  and sal.activity_type = 'PACKING'
  and sal.activity_date between cw.week_start_date and cw.week_end_date
left join s8_time_logs stl
  on stl.employee_id = e.id
  and stl.log_date between cw.week_start_date and cw.week_end_date
  and stl.task_mapping_id in (select id from task_mapping where kpi_department = 'Expédition' and include_in_kpi = true)
  and stl.validation_status = 'validated'
where e.is_active = true
group by cw.week_start_date, cw.label, e.id, e.full_name;

-- Vue: KPI réception par employé par semaine
create or replace view vw_kpi_receiving_week as
select
  cw.week_start_date,
  cw.label as week_label,
  e.id as employee_id,
  e.full_name,
  count(distinct sal.id) as sap_lines,
  coalesce(sum(stl.duration_minutes) / 60.0, 0) as s8_hours,
  case when coalesce(sum(stl.duration_minutes), 0) > 0
    then round(count(distinct sal.id) / (sum(stl.duration_minutes) / 60.0), 2)
    else null
  end as lines_per_hour
from calendar_weeks cw
cross join employees e
left join sap_activity_lines sal
  on sal.employee_id = e.id
  and sal.activity_type = 'RECEIVING'
  and sal.activity_date between cw.week_start_date and cw.week_end_date
left join s8_time_logs stl
  on stl.employee_id = e.id
  and stl.log_date between cw.week_start_date and cw.week_end_date
  and stl.task_mapping_id in (select id from task_mapping where kpi_department = 'Réception' and include_in_kpi = true)
  and stl.validation_status = 'validated'
where e.is_active = true
group by cw.week_start_date, cw.label, e.id, e.full_name;

-- Vue: KPI production par employé par semaine
create or replace view vw_kpi_production_week as
select
  cw.week_start_date,
  cw.label as week_label,
  e.id as employee_id,
  e.full_name,
  coalesce(sum(
    pa.setup_minutes + pa.quantity_produced * pa.std_minutes
  ), 0) as standard_minutes,
  coalesce(sum(spa.actual_minutes), 0) as actual_minutes,
  case when coalesce(sum(spa.actual_minutes), 0) > 0
    then round(
      sum(pa.setup_minutes + pa.quantity_produced * pa.std_minutes) /
      sum(spa.actual_minutes) * 100, 1
    )
    else null
  end as productivity_pct
from calendar_weeks cw
cross join employees e
left join s8_production_actuals spa
  on spa.employee_id = e.id
  and spa.production_date between cw.week_start_date and cw.week_end_date
left join lateral (
  select
    ps.setup_minutes,
    spa.quantity_produced,
    ps.standard_minutes_per_unit as std_minutes
  from production_standards ps
  where ps.item_code = spa.item_code
    and ps.is_active = true
    and ps.effective_date <= spa.production_date
  order by ps.effective_date desc
  limit 1
) pa on true
where e.is_active = true
group by cw.week_start_date, cw.label, e.id, e.full_name;

-- Vue: conformité des logs S8 par semaine
create or replace view vw_data_quality_week as
select
  cw.week_start_date,
  cw.label as week_label,
  count(*) as total_logs,
  count(*) filter (where stl.validation_status = 'validated') as validated_logs,
  count(*) filter (where stl.employee_id is null) as unmapped_employees,
  count(*) filter (where stl.task_mapping_id is null) as unmapped_tasks,
  count(*) filter (where stl.duration_minutes <= 0) as zero_duration_logs,
  case when count(*) > 0
    then round(count(*) filter (where stl.validation_status = 'validated') * 100.0 / count(*), 1)
    else null
  end as conformity_pct
from calendar_weeks cw
left join s8_time_logs stl on stl.log_date between cw.week_start_date and cw.week_end_date
group by cw.week_start_date, cw.label;

-- ─── Désactiver RLS sur les nouvelles tables ─────────────────
alter table employee_system_mapping disable row level security;
alter table task_mapping disable row level security;
alter table calendar_weeks disable row level security;
alter table import_batches disable row level security;
alter table s8_time_logs disable row level security;
alter table sap_activity_lines disable row level security;
alter table s8_production_actuals disable row level security;
alter table production_standards disable row level security;
alter table sap_prereceptions disable row level security;
