-- ─────────────────────────────────────────────────────────────────────────────
-- Motifs d'absence alignés sur les banques Nethris (libellés superviseur)
-- Phase 1 : catalogue + lien sur capacity_events. Pas d'API Nethris.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists nethris_absence_reasons (
  id                 text        primary key,
  supervisor_label   text        not null,
  nethris_label      text,       -- vide pour absence non payée
  event_type         text        not null
                     check (event_type in ('planned_absence', 'unplanned_absence')),
  sort_order         int         not null default 0,
  active             boolean     not null default true
);

insert into nethris_absence_reasons (id, supervisor_label, nethris_label, event_type, sort_order) values
  ('flex',       'Heure Flex',                          'Banque congés flex',              'unplanned_absence', 1),
  ('unpaid',     'Absence non payée',                   null,                              'unplanned_absence', 2),
  ('vacation',   'Vacances',                            'Banque de vacances',              'planned_absence',   3),
  ('bank_reg',   'Banque de temps (taux régulier)',     'Payer B.Temps 1,0 (taux reg)',    'planned_absence',   4),
  ('bank_ot',    'Banque de temps (temps supplémentaire)', 'Payer B.Temps 1,5 (taux supp)', 'planned_absence',   5),
  ('initiative', 'Banque initiative',                   'Payer B. Initiative (reg. 1.0)',  'planned_absence',   6)
on conflict (id) do update set
  supervisor_label = excluded.supervisor_label,
  nethris_label    = excluded.nethris_label,
  event_type       = excluded.event_type,
  sort_order       = excluded.sort_order;

alter table capacity_events
  add column if not exists nethris_reason_id text
  references nethris_absence_reasons(id);

comment on table nethris_absence_reasons is
  'Motifs d''absence affichés au superviseur, mappés aux banques Nethris (phase 2 : codes Gxxx / API).';

comment on column capacity_events.nethris_reason_id is
  'Motif banque Nethris pour planned_absence / unplanned_absence. Null pour retard, départ hâtif, ou événements legacy.';
