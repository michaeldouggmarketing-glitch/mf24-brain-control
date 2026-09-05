create or replace function public.mf24_brain_resolve_channel_link(p_channel text, p_external_subject_hash text)
returns table(mf24_user_id uuid, mf24_space_id text, status text)
language sql
security definer
set search_path = mf24_brain, public
as $$
  select cl.mf24_user_id, cl.mf24_space_id, cl.status
  from mf24_brain.channel_links cl
  where cl.channel = p_channel
    and cl.external_subject_hash = p_external_subject_hash
    and cl.status = 'active'
  order by cl.updated_at desc
  limit 1;
$$;

revoke all on function public.mf24_brain_resolve_channel_link(text,text) from public, anon, authenticated;
grant execute on function public.mf24_brain_resolve_channel_link(text,text) to service_role;
