-- ============================================================
-- Corrections task_mapping pour import S8
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- 1. Pause — présente dans tous les fichiers S8, à exclure des KPI
insert into task_mapping (s8_task_name, kpi_department, is_productive, is_direct_labor, include_in_kpi)
values ('Pause', 'Support', false, false, false)
on conflict (s8_task_name) do nothing;

-- 2. Variante longue de "Gestion inventaire" telle qu'elle apparaît dans S8
insert into task_mapping (s8_task_name, kpi_department, is_productive, is_direct_labor, include_in_kpi)
values ('Gestion inventaire (Décompte, Remplissage, Recherche, ...)', 'Inventaire', true, true, false)
on conflict (s8_task_name) do nothing;

-- 3. Typo dans S8 : "bali" au lieu de "balai" — même département que la version correcte
insert into task_mapping (s8_task_name, kpi_department, is_productive, is_direct_labor, include_in_kpi)
values ('Nettoyer, pelleter, bali, mouvement mobilier', 'Support', false, false, false)
on conflict (s8_task_name) do nothing;

-- 4. Variante avec suffixe de gamme "(S50)" — même logique que la version sans suffixe
insert into task_mapping (s8_task_name, kpi_department, is_productive, is_direct_labor, include_in_kpi)
values ('Production non-codé / modification produits (S50)', 'Production', true, true, true)
on conflict (s8_task_name) do nothing;
