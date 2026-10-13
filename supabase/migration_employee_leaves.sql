-- ─────────────────────────────────────────────────────────────────────────────
-- Congés prolongés (maladie, blessure, dépression, etc.)
-- Un employé en congé prolongé est exclu des calculs de capacité,
-- des compteurs d'absent/présent et des KPI pour toute la période.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists employee_leaves (
  id          uuid        primary key default gen_random_uuid(),
  employee_id uuid        not null references employees(id) on delete cascade,
  start_date  date        not null,
  end_date    date,                   -- null = congé en cours (sans date de fin connue)
  reason      text        not null default 'other'
                constraint employee_leaves_reason_check
                check (reason in ('medical', 'injury', 'mental', 'personal', 'other')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists employee_leaves_employee_idx on employee_leaves(employee_id);
create index if not exists employee_leaves_dates_idx    on employee_leaves(start_date, end_date);

comment on table employee_leaves is
  'Périodes d''absence prolongée (maladie, blessure, dépression…). '
  'L''employé est exclu des calculs de capacité et des KPI pendant cette période.';

comment on column employee_leaves.end_date is
  'Null = congé toujours en cours. Remplir quand l''employé reprend le travail.';
