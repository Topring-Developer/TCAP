-- ============================================================
-- Migration: ajout de deactivated_at à la table employees
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- 1. Ajouter la colonne (nullable = employé encore actif)
alter table public.employees
  add column if not exists deactivated_at timestamptz null;

-- 2. Les employés déjà marqués is_active = false reçoivent une date
--    de désactivation fictive (now()) pour ne pas casser la logique
update public.employees
set deactivated_at = now()
where is_active = false
  and deactivated_at is null;

-- 3. Index pour les requêtes de filtrage historique
create index if not exists idx_employees_deactivated_at
  on public.employees(deactivated_at);
