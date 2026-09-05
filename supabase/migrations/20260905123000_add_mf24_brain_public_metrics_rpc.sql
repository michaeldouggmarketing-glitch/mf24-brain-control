create or replace function public.mf24_brain_public_metrics()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, mf24_brain
as $$
  select jsonb_build_object(
    'categories', (select count(*) from mf24_brain.categories),
    'entities', (select count(*) from mf24_brain.entities),
    'aliases', (select count(*) from mf24_brain.entity_aliases),
    'rules', (select count(*) from mf24_brain.rules),
    'knowledge_items', (select count(*) from mf24_brain.knowledge_items),
    'sources', (select count(*) from mf24_brain.source_registry)
  );
$$;

revoke all on function public.mf24_brain_public_metrics() from public, anon, authenticated;
grant execute on function public.mf24_brain_public_metrics() to service_role;
comment on function public.mf24_brain_public_metrics() is
  'Sanitized aggregate inventory for the MF24 Brain Control Center; callable only by service_role.';
