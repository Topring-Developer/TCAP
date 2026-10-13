-- ============================================================
-- Migration KPI Picking — stats par vague (WaveKey)
-- 1 row SAP = 1 ligne item ; agrégé par WaveKey × mois à l'import
-- ============================================================

create table if not exists picking_wave_stats (
  id uuid primary key default gen_random_uuid(),
  external_key text not null,
  import_batch_id uuid null references import_batches(id),
  wave_key text not null,
  period_month text not null,
  doc_date date not null,
  line_count integer not null default 0,
  picklist_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint picking_wave_stats_external_key_key unique (external_key)
);

create index if not exists idx_pick_wave_month on picking_wave_stats(period_month);
create index if not exists idx_pick_wave_key on picking_wave_stats(wave_key);

alter table picking_wave_stats disable row level security;
