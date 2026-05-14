-- ============================================================
-- SEED — Données initiales
-- À exécuter APRÈS schema.sql dans l'éditeur SQL de Supabase
-- ============================================================

-- ─── 1. Employés ─────────────────────────────────────────────
insert into employees (full_name, is_active) values
  ('Stéphane Archambault',      true),
  ('Marcel Bissonnette',        true),
  ('Rabah Bouhloul',            true),
  ('Lucie Danis',               true),
  ('Sylvain Daunais',           true),
  ('Alyson Davis-Sanschagrin',  true),
  ('Marie-Pier Grondin',        true),
  ('Roxane Hrycyk',             true),
  ('Lucas Larocque',            true),
  ('Marie-Eve Lesage',          true),
  ('Ekaterina Popova',          true),
  ('Shawn Poulin',              true),
  ('Louis Rodrigue',            true),
  ('Sylvie Rondeau',            true),
  ('Valentina Vallejo',         true),
  ('Jude Volny',                true),
  ('Jean Sébastien Waltz',      true),
  ('Yann Gauthier',             true),
  ('Jérémy Nadeau',             true),
  ('Frédérick Lachance',        true),
  ('Réparation',                true)
on conflict do nothing;

-- ─── 2. Jours fériés ─────────────────────────────────────────
insert into public_holidays (date, label) values
  -- 2025
  ('2025-01-01', 'Jour de l''An'),
  ('2025-04-18', 'Vendredi saint'),
  ('2025-05-19', 'Fête des Patriotes'),
  ('2025-06-24', 'Saint-Jean-Baptiste'),
  ('2025-07-01', 'Fête du Canada'),
  ('2025-09-01', 'Fête du Travail'),
  ('2025-10-13', 'Action de grâce'),
  ('2025-12-25', 'Noël'),
  ('2025-12-26', 'Lendemain Noël (TOPRINGS)'),
  -- 2026
  ('2026-01-01', 'Jour de l''An'),
  ('2026-04-03', 'Vendredi saint'),
  ('2026-05-18', 'Fête des Patriotes'),
  ('2026-06-24', 'Saint-Jean-Baptiste'),
  ('2026-07-01', 'Fête du Canada'),
  ('2026-09-07', 'Fête du Travail'),
  ('2026-10-12', 'Action de grâce'),
  ('2026-12-25', 'Noël'),
  ('2026-12-28', 'Lendemain Noël (TOPRINGS)')
on conflict (date) do nothing;
