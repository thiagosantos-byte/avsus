begin;
select plan(17);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'favorite_searches', 'favorite_searches table exists');
select has_table('public', 'saved_filters', 'saved_filters table exists');
select has_table('public', 'saved_map_views', 'saved_map_views table exists');
select has_table('public', 'user_preferences', 'user_preferences table exists');
select has_table('public', 'search_history', 'search_history table exists');
select has_table('public', 'api_cache', 'api_cache table exists');
select has_table('public', 'health_facilities', 'health_facilities table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.favorite_searches'::regclass), 'RLS enabled on favorite_searches');
select ok((select relrowsecurity from pg_class where oid = 'public.saved_filters'::regclass), 'RLS enabled on saved_filters');
select ok((select relrowsecurity from pg_class where oid = 'public.saved_map_views'::regclass), 'RLS enabled on saved_map_views');
select ok((select relrowsecurity from pg_class where oid = 'public.health_facilities'::regclass), 'RLS enabled on health_facilities');

-- Two isolated identities are created for an actual RLS visibility test.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@healthdata.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('b0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@healthdata.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
on conflict (id) do nothing;

insert into public.saved_filters (user_id, name, source_key, filters) values
  ('a0000000-0000-4000-8000-000000000001', 'Filtro privado A', 'dengue', '{"nu_ano":"2025"}'),
  ('b0000000-0000-4000-8000-000000000002', 'Filtro privado B', 'zika', '{"nu_ano":"2024"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.saved_filters where name = 'Filtro privado A'), 1, 'user A can read own saved filter');
select is((select count(*)::integer from public.saved_filters where name = 'Filtro privado B'), 0, 'user A cannot read user B saved filter');
select throws_ok(
  $$insert into public.saved_filters (user_id, name, source_key, filters) values ('b0000000-0000-4000-8000-000000000002', 'Tentativa cross-account', 'dengue', '{}')$$,
  '42501',
  null,
  'user A cannot insert a record owned by user B'
);

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.saved_filters where name = 'Filtro privado B'), 1, 'user B can read own saved filter');
select is((select count(*)::integer from public.saved_filters where name = 'Filtro privado A'), 0, 'user B cannot read user A saved filter');

reset role;
select * from finish();
rollback;
