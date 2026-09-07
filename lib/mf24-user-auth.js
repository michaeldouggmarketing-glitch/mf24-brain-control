const DEFAULT_URL = 'https://xjksqwlidkhvobiklisi.supabase.co';

function config() {
  const url = String(process.env.MF24_PROD_URL || DEFAULT_URL).replace(/\/$/, '');
  const key = process.env.MF24_PROD_SERVICE_ROLE_KEY;
  if (!key) throw Object.assign(new Error('mf24_prod_service_role_not_configured'), {status:503});
  return {url, key};
}

function bearer(req) {
  const value = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return value || '';
}

function serviceHeaders(key, token = key) {
  return {apikey:key, authorization:`Bearer ${token}`, 'content-type':'application/json'};
}

export async function authenticateMf24AppUser(req, {spaceId, fetchImpl=fetch} = {}) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error('mf24_user_session_required'), {status:401});
  if (typeof spaceId !== 'string' || !spaceId.trim() || spaceId.length > 120) {
    throw Object.assign(new Error('invalid_mf24_space_id'), {status:400});
  }

  const {url,key} = config();
  const auth = await fetchImpl(`${url}/auth/v1/user`, {
    headers:serviceHeaders(key, token),
    signal:AbortSignal.timeout(9000),
  });
  if (!auth.ok) throw Object.assign(new Error('invalid_mf24_user_session'), {status:401});
  const user = await auth.json().catch(() => ({}));
  const userId = typeof user?.id === 'string' ? user.id : '';
  if (!userId) throw Object.assign(new Error('invalid_mf24_user_session'), {status:401});

  const memberQuery = new URLSearchParams({
    select:'space_id,status,access,role',
    space_id:`eq.${spaceId}`,
    user_id:`eq.${userId}`,
    status:'eq.active',
    limit:'1',
  });
  const membership = await fetchImpl(`${url}/rest/v1/mf24_workspace_members?${memberQuery}`, {
    headers:serviceHeaders(key),
    signal:AbortSignal.timeout(9000),
  });
  if (!membership.ok) throw Object.assign(new Error('mf24_workspace_authorization_unavailable'), {status:503});
  const members = await membership.json().catch(() => []);
  if (!Array.isArray(members) || !members.length) {
    throw Object.assign(new Error('mf24_workspace_access_required'), {status:403});
  }

  const workspaceQuery = new URLSearchParams({
    select:'space_id,space_type,active',
    space_id:`eq.${spaceId}`,
    active:'eq.true',
    limit:'1',
  });
  const workspace = await fetchImpl(`${url}/rest/v1/mf24_workspaces?${workspaceQuery}`, {
    headers:serviceHeaders(key),
    signal:AbortSignal.timeout(9000),
  });
  if (!workspace.ok) throw Object.assign(new Error('mf24_workspace_authorization_unavailable'), {status:503});
  const spaces = await workspace.json().catch(() => []);
  const row = Array.isArray(spaces) ? spaces[0] : null;
  const spaceType = row?.space_type;
  if (spaceType !== 'personal' && spaceType !== 'household') {
    throw Object.assign(new Error('generative_ai_personal_only'), {status:403});
  }

  return {
    role:'mf24_user',
    userId,
    spaceId,
    spaceType,
    access:members[0]?.access || null,
    memberRole:members[0]?.role || null,
  };
}
