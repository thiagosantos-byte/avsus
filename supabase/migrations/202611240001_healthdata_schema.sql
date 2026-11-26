-- HealthData Brasil — esquema inicial PostgreSQL/Supabase.
-- Não armazena notificações individuais nem dados clínicos identificáveis.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.favorite_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  source_key text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  source_key text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_map_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  center_lat double precision,
  center_lng double precision,
  zoom smallint check (zoom between 2 and 18),
  layers jsonb not null default '[]'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light','dark')),
  locale text not null default 'pt-BR',
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  filters jsonb not null default '{}'::jsonb,
  result_count integer not null default 0 check (result_count >= 0),
  created_at timestamptz not null default now()
);

-- Cache operacional. A tabela fica fechada para anon/authenticated e é acessada
-- exclusivamente pelo backend quando a service role estiver configurada.
create table if not exists public.api_cache (
  cache_key text primary key,
  source_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint api_cache_expiry_check check (expires_at > fetched_at)
);

create table if not exists public.api_sync_logs (
  id bigint generated always as identity primary key,
  source_key text not null,
  status text not null check (status in ('success','error','warning')),
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Cache geográfico apenas de dados públicos de estabelecimentos, sem pacientes.
create table if not exists public.health_facilities (
  cnes_code text primary key,
  name text,
  facility_type text,
  municipality_code text,
  municipality_name text,
  state_code char(2),
  latitude double precision,
  longitude double precision,
  source_competence text,
  source_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint health_facilities_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint health_facilities_longitude_check check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.geographic_cache (
  cache_key text primary key,
  provider text not null,
  query_hash text not null,
  latitude double precision,
  longitude double precision,
  precision_label text,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint geographic_cache_expiry_check check (expires_at > fetched_at),
  constraint geographic_cache_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint geographic_cache_longitude_check check (longitude is null or longitude between -180 and 180)
);

create index if not exists favorite_searches_user_created_idx on public.favorite_searches(user_id, created_at desc);
create index if not exists saved_filters_user_updated_idx on public.saved_filters(user_id, updated_at desc);
create index if not exists saved_map_views_user_created_idx on public.saved_map_views(user_id, created_at desc);
create index if not exists search_history_user_created_idx on public.search_history(user_id, created_at desc);
create index if not exists api_sync_logs_source_completed_idx on public.api_sync_logs(source_key, completed_at desc);
create index if not exists health_facilities_municipality_idx on public.health_facilities(state_code, municipality_code);
create index if not exists health_facilities_geo_idx on public.health_facilities(latitude, longitude) where latitude is not null and longitude is not null;
create index if not exists api_cache_expiry_idx on public.api_cache(expires_at);
create index if not exists geographic_cache_expiry_idx on public.geographic_cache(expires_at);

-- RLS habilitado em todas as tabelas expostas no schema public.
alter table public.profiles enable row level security;
alter table public.favorite_searches enable row level security;
alter table public.saved_filters enable row level security;
alter table public.saved_map_views enable row level security;
alter table public.user_preferences enable row level security;
alter table public.search_history enable row level security;
alter table public.api_cache enable row level security;
alter table public.api_sync_logs enable row level security;
alter table public.health_facilities enable row level security;
alter table public.geographic_cache enable row level security;

-- Remove permissões implícitas; concessões abaixo são deliberadamente mínimas.
revoke all on public.profiles, public.favorite_searches, public.saved_filters,
  public.saved_map_views, public.user_preferences, public.search_history,
  public.api_cache, public.api_sync_logs, public.health_facilities,
  public.geographic_cache from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.favorite_searches to authenticated;
grant select, insert, update, delete on public.saved_filters to authenticated;
grant select, insert, update, delete on public.saved_map_views to authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant select, insert, delete on public.search_history to authenticated;
grant usage, select on sequence public.api_sync_logs_id_seq to service_role;
grant all on public.api_cache, public.api_sync_logs, public.health_facilities, public.geographic_cache to service_role;

-- Perfil individual: todas as operações privadas limitadas ao auth.uid().
drop policy if exists "profile_select_own" on public.profiles;
create policy "profile_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profile_insert_own" on public.profiles;
create policy "profile_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Políticas por usuário para consultas favoritas.
create policy "favorite_searches_select_own" on public.favorite_searches for select to authenticated using ((select auth.uid()) = user_id);
create policy "favorite_searches_insert_own" on public.favorite_searches for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "favorite_searches_update_own" on public.favorite_searches for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "favorite_searches_delete_own" on public.favorite_searches for delete to authenticated using ((select auth.uid()) = user_id);

create policy "saved_filters_select_own" on public.saved_filters for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_filters_insert_own" on public.saved_filters for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "saved_filters_update_own" on public.saved_filters for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved_filters_delete_own" on public.saved_filters for delete to authenticated using ((select auth.uid()) = user_id);

create policy "saved_map_views_select_own" on public.saved_map_views for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_map_views_insert_own" on public.saved_map_views for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "saved_map_views_update_own" on public.saved_map_views for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved_map_views_delete_own" on public.saved_map_views for delete to authenticated using ((select auth.uid()) = user_id);

create policy "user_preferences_select_own" on public.user_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_preferences_insert_own" on public.user_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_preferences_update_own" on public.user_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_preferences_delete_own" on public.user_preferences for delete to authenticated using ((select auth.uid()) = user_id);

create policy "search_history_select_own" on public.search_history for select to authenticated using ((select auth.uid()) = user_id);
create policy "search_history_insert_own" on public.search_history for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "search_history_delete_own" on public.search_history for delete to authenticated using ((select auth.uid()) = user_id);

-- Não há policies para cache/logs/estabelecimentos: somente service_role tem grants.

-- Trigger privado para provisionar perfil quando uma conta é criada.
create or replace function private.handle_new_healthdata_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_healthdata_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_healthdata on auth.users;
create trigger on_auth_user_created_healthdata
after insert on auth.users
for each row execute function private.handle_new_healthdata_user();
