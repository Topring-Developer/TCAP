-- ─────────────────────────────────────────────────────────────────────────────
-- Ajout du champ kind sur employee_adjustments
-- 'overtime'  = heures supplémentaires travaillées (payées ou accumulées)
-- 'recovery'  = récupération d'une absence (compense une exclusion partielle)
-- Les enregistrements positifs existants gardent la valeur par défaut 'overtime'.
-- ─────────────────────────────────────────────────────────────────────────────

alter table employee_adjustments
  add column if not exists kind text not null default 'overtime'
  constraint employee_adjustments_kind_check
    check (kind in ('overtime', 'recovery'));

comment on column employee_adjustments.kind is
  'overtime = heure sup payée/accumulée ; recovery = récupère une absence';
