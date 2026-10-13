-- Ajouter la date d'embauche sur les employés
-- Permet de délimiter la fenêtre d'emploi : hired_at → deactivated_at
-- Utilisé par l'analyse TWMS pour éviter les faux positifs d'absence
-- avant qu'un employé saisonnier ne soit en poste.

alter table employees
  add column if not exists hired_at date null;

-- Index optionnel si les requêtes filtrent par fenêtre d'emploi
create index if not exists idx_employees_hired_at on employees(hired_at);

comment on column employees.hired_at is
  'Date de début d''emploi (ex: 2026-05-01 pour un étudiant saisonnier). '
  'Null = employé de longue date dont la date n''est pas connue. '
  'L''analyse TWMS ignore les journées avant cette date.';
