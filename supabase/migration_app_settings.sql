-- Réglages applicatifs (source SAP : supabase | wrapper)
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_settings_updated_at on app_settings;
create trigger app_settings_updated_at before update on app_settings
  for each row execute function set_updated_at();

alter table app_settings disable row level security;

insert into app_settings (key, value)
values ('sap_data_source', 'supabase')
on conflict (key) do nothing;
