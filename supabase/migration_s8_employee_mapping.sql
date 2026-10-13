-- ============================================================
-- Mapping employés TCAP ↔ S8 / TWMS
-- external_employee_name = nom décodé tel qu'il apparaît dans le CSV après
-- décodage des entités HTML (ex: J&eacute;r&eacute;my → Jérémy)
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

insert into employee_system_mapping
  (employee_id, system_name, external_employee_name, is_active)
select e.id, 'S8', s.s8_name, true
from (values
  -- Nom TCAP                          Nom S8 (après décodage HTML)
  ('Alyson Davis-Sanschagrin',         'Alyson Davis-Sanschagrin'),
  ('Ekaterina Popova',                 'Ekaterina Popova'),
  ('Frédérick Lachance',               'Frédérick Lachance'),
  ('Jean Sébastien Waltz',             'Jean Sébastien Waltz'),
  ('Jennifer Messier',                 'Jennifer Messier'),
  ('Jérémy Nadeau',                    'Jérémy Nadeau'),
  ('Jude Volny',                       'Jude Volny'),
  ('Louis Rodrigue',                   'Louis Rodrigue'),
  ('Lucas Larocque',                   'Lucas Larocque'),
  ('Lucie Danis',                      'Lucie Danis'),
  ('Marcel Bissonnette',               'Marcel Bissonnette'),
  ('Marie-Eve Lesage',                 'Marie-Eve Lesage'),
  ('Marie-Pier Grondin',               'Marie-Pier Grondin'),
  ('Rabah Bouhloul',                   'Rabah Bouhloul'),
  ('Réparation',                       'Réparation'),
  ('Roxane Hrycyk',                    'Roxane Hrycyk'),
  ('Shawn Poulin',                     'Shawn Poulin'),
  ('Stéphane Archambault',             'Stéphane Archambault'),
  ('Sylvain Daunais',                  'Sylvain Daunais'),
  ('Sylvie Rondeau',                   'Sylvie Rondeau'),
  ('Valentina Vallejo',                'Valentina Vallejo'),
  ('Yann Gauthier',                    'Yann Gauthier')
) as s(tcap_name, s8_name)
join employees e on e.full_name = s.tcap_name
on conflict (employee_id, system_name) do nothing;

-- Vérification : mappings S8 créés
select e.full_name as tcap, m.external_employee_name as s8_name, e.is_active
from employee_system_mapping m
join employees e on e.id = m.employee_id
where m.system_name = 'S8'
order by e.full_name;
