-- ─────────────────────────────────────────────────────────────────────────────
-- Reprise de temps (+heures) + motif Absence avec reprise de temps
-- Retire Retard / Départ hâtif de l'UI seulement (types conservés en DB)
-- ─────────────────────────────────────────────────────────────────────────────

alter table capacity_events drop constraint if exists capacity_events_type_check;

alter table capacity_events add constraint capacity_events_type_check
  check (event_type in (
    'overtime',
    'part_time_boost',
    'time_recovery',
    'late',
    'early_departure',
    'planned_absence',
    'unplanned_absence'
  ));

insert into nethris_absence_reasons (id, supervisor_label, nethris_label, event_type, sort_order) values
  ('with_recovery', 'Absence avec reprise de temps', null, 'planned_absence', 7)
on conflict (id) do update set
  supervisor_label = excluded.supervisor_label,
  nethris_label    = excluded.nethris_label,
  event_type       = excluded.event_type,
  sort_order       = excluded.sort_order;
