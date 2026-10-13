-- ============================================================
-- Migration : Logs de production SAP ligne par ligne
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- Table des logs bruts de production SAP
-- Chaque ligne = une opération par employé sur un item donné,
-- avec horodatage de début et de fin.
create table if not exists production_log_lines (
  id                uuid        primary key default gen_random_uuid(),
  import_batch_id   uuid        null references import_batches(id) on delete set null,
  id_sap            text        not null,           -- identifiant employé dans SAP
  itemcode          text        not null,            -- code item (ex: 31.749)
  bom               text        null,               -- numéro de BOM
  num_commande      text        null,               -- numéro de commande (peut être null)
  quantity          numeric(12,4) not null default 0,
  timestamp_begin   timestamptz null,
  timestamp_end     timestamptz null,
  duration_minutes  numeric(10,2) null,             -- calculé : (timestamp_end - timestamp_begin) en minutes
  period_month      text        not null,            -- YYYY-MM dérivé de timestamp_begin
  created_at        timestamptz not null default now()
);

-- Index pour les requêtes de drill-down (itemcode + période)
create index if not exists idx_prod_log_item_month  on production_log_lines(itemcode, period_month);
-- Index pour l'agrégation par employé SAP
create index if not exists idx_prod_log_id_sap      on production_log_lines(id_sap);
-- Index pour le filtre par batch d'import
create index if not exists idx_prod_log_batch       on production_log_lines(import_batch_id);
-- Index pour les requêtes par période
create index if not exists idx_prod_log_period      on production_log_lines(period_month);

-- Désactiver RLS (cohérent avec les autres tables du projet)
alter table production_log_lines disable row level security;
