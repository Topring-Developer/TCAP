-- ============================================================
-- Mapping employés TCAP ↔ SAP (codes scanners 4 chiffres)
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

insert into employee_system_mapping
  (employee_id, system_name, external_employee_code, is_active)
select e.id, 'SAP', s.code, true
from (values
  -- Nom TCAP                          Code SAP
  ('Alyson Davis-Sanschagrin',         '1244'),
  ('Ekaterina Popova',                 '1019'),
  ('Frédérick Lachance',               '1327'),
  ('Jean Sébastien Waltz',             '1259'),
  ('Jérémy Nadeau',                    '1325'),
  ('Jude Volny',                       '1290'),
  ('Louis Rodrigue',                   '0030'),
  ('Lucie Danis',                      '0971'),
  ('Marcel Bissonnette',               '1124'),
  ('Marie-Eve Lesage',                 '1267'),
  ('Marie-Pier Grondin',               '1315'),
  ('Réparation',                       '0024'),
  ('Roxane Hrycyk',                    '1303'),
  ('Shawn Poulin',                     '1299'),
  ('Stéphane Archambault',             '1289'),
  ('Sylvain Daunais',                  '1197'),
  ('Sylvie Rondeau',                   '1241'),
  ('Yann Gauthier',                    '1287')
) as s(tcap_name, code)
join employees e on e.full_name = s.tcap_name
on conflict (employee_id, system_name) do nothing;

-- Employés SAP sans équivalent TCAP (à créer si nécessaire)
-- Kassandra McCullough  → 1333
-- Michel Beauregard     → 0029
-- Nicolas Ménard        → 1329

-- Employés TCAP sans scanner SAP (pas de KPI SAP pour eux)
-- Jennifer Messier  (temps partiel, non prévu)
-- Lucas Larocque    (inactif)
-- Rabah Bouhloul    (inactif)
-- Valentina Vallejo

-- Vérification : mappings SAP créés
select e.full_name as tcap, m.external_employee_code as code_sap, e.is_active
from employee_system_mapping m
join employees e on e.id = m.employee_id
where m.system_name = 'SAP'
order by e.full_name;
