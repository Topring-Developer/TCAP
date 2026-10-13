-- Contrainte UNIQUE complète sur item_code (requise pour upsert PostgREST)
-- À exécuter si besoin d'upsert futur ; l'import TCAP utilise insert après delete.

-- Supprimer l'index partiel s'il existe (remplacé par contrainte complète)
drop index if exists idx_production_standards_item_code;

-- Un seul standard par code item
create unique index if not exists idx_production_standards_item_code_unique
  on production_standards (item_code);
