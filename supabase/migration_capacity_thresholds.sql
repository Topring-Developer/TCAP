-- Seuils de sous-effectif par jour de la semaine
-- Permet de déclencher une alerte visuelle dans le calendrier de présence

create table if not exists capacity_thresholds (
  weekday      int primary key check (weekday between 1 and 5), -- 1=lundi … 5=vendredi
  min_employees int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Valeurs initiales à zéro (aucune alerte par défaut)
insert into capacity_thresholds (weekday, min_employees)
values (1, 0), (2, 0), (3, 0), (4, 0), (5, 0)
on conflict (weekday) do nothing;

-- Trigger updated_at
create trigger set_capacity_thresholds_updated_at
  before update on capacity_thresholds
  for each row execute procedure set_updated_at();

alter table capacity_thresholds disable row level security;
