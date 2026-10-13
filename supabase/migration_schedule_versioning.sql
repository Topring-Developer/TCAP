-- ─────────────────────────────────────────────────────────────────────────────
-- Versionnage des horaires employés
-- Permet de conserver l'historique des horaires (ex: TF → TP rentrée scolaire)
-- ─────────────────────────────────────────────────────────────────────────────

alter table employee_work_schedule
  add column if not exists effective_from date not null default '2020-01-01',
  add column if not exists effective_to   date;  -- NULL = horaire actuellement actif

-- Index pour les requêtes par date effective
create index if not exists employee_work_schedule_versioning_idx
  on employee_work_schedule(employee_id, weekday, effective_from);

-- Contrainte : un seul horaire actif (effective_to IS NULL) par employé/jour
-- (les horaires archivés peuvent coexister sur le même employee_id + weekday)
create unique index if not exists employee_work_schedule_active_idx
  on employee_work_schedule(employee_id, weekday)
  where effective_to is null;

comment on column employee_work_schedule.effective_from is
  'Date à partir de laquelle cet horaire s''applique (incluse). Défaut : 2020-01-01.';

comment on column employee_work_schedule.effective_to is
  'Dernier jour où cet horaire s''applique (inclus). NULL = horaire actuellement actif.';

comment on table employee_work_schedule is
  'Horaires hebdomadaires des employés avec versionnage historique. '
  'Pour changer d''horaire : fermer l''actif (effective_to = veille) et insérer le nouveau (effective_from = date effective). '
  'Un seul horaire peut être actif (effective_to IS NULL) par employé/jour.';
