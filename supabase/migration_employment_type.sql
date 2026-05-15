-- ============================================================
-- Migration: ajout employment_type à employees
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

alter table public.employees
  add column if not exists employment_type text not null default 'full_time'
  check (employment_type in ('full_time', 'part_time'));

-- Mettre à jour les employés temps partiel connus
update public.employees set employment_type = 'part_time'
where full_name in (
  'Alyson Davis-Sanschagrin',
  'Lucas Larocque',
  'Ekaterina Popova',
  'Valentina Vallejo',
  'Jérémy Nadeau',
  'Frédérick Lachance'
);
