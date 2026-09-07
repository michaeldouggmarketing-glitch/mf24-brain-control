import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateMf24AppUser} from '../lib/mf24-user-auth.js';

const originalRole = process.env.MF24_PROD_SERVICE_ROLE_KEY;
process.env.MF24_PROD_SERVICE_ROLE_KEY = 'service-role-test';

function req(token='user-jwt') {
  return {headers:{authorization:`Bearer ${token}`}};
}

function fetcher({authOk=true, member=true, spaceType='personal'} = {}) {
  const calls = [];
  const impl = async (url, init={}) => {
    calls.push({url:String(url), init});
    if (String(url).endsWith('/auth/v1/user')) {
      return authOk
        ? {ok:true, json:async () => ({id:'00000000-0000-4000-8000-000000000001'})}
        : {ok:false, json:async () => ({})};
    }
    if (String(url).includes('/rest/v1/mf24_workspace_members?')) {
      return {ok:true, json:async () => member ? [{space_id:'personal:real',status:'active',access:'manage',role:'owner'}] : []};
    }
    if (String(url).includes('/rest/v1/mf24_workspaces?')) {
      return {ok:true, json:async () => [{space_id:'personal:real',space_type:spaceType,active:true}]};
    }
    throw new Error(`unexpected ${url}`);
  };
  return {calls, impl};
}

test('valid MF24 session is independently resolved to its real user and workspace', async () => {
  const {calls,impl} = fetcher();
  const result = await authenticateMf24AppUser(req(), {spaceId:'personal:real', fetchImpl:impl});
  assert.equal(result.userId, '00000000-0000-4000-8000-000000000001');
  assert.equal(result.spaceId, 'personal:real');
  assert.equal(result.spaceType, 'personal');
  const authCall = calls.find(call => call.url.endsWith('/auth/v1/user'));
  assert.equal(authCall.init.headers.authorization, 'Bearer user-jwt');
  const memberCall = calls.find(call => call.url.includes('mf24_workspace_members'));
  assert.match(memberCall.url, /user_id=eq%5C?\.?00000000|user_id=eq\.00000000/);
});

test('invalid session is rejected before private context can be loaded', async () => {
  const {impl} = fetcher({authOk:false});
  await assert.rejects(
    () => authenticateMf24AppUser(req('bad'), {spaceId:'personal:real', fetchImpl:impl}),
    error => error.status === 401 && error.message === 'invalid_mf24_user_session',
  );
});

test('valid user cannot name a workspace without an active membership', async () => {
  const {impl} = fetcher({member:false});
  await assert.rejects(
    () => authenticateMf24AppUser(req(), {spaceId:'personal:other', fetchImpl:impl}),
    error => error.status === 403 && error.message === 'mf24_workspace_access_required',
  );
});

test('business workspace is not exposed through personal generative Brain', async () => {
  const {impl} = fetcher({spaceType:'business'});
  await assert.rejects(
    () => authenticateMf24AppUser(req(), {spaceId:'business:1', fetchImpl:impl}),
    error => error.status === 403 && error.message === 'generative_ai_personal_only',
  );
});

test.after(() => {
  if (originalRole === undefined) delete process.env.MF24_PROD_SERVICE_ROLE_KEY;
  else process.env.MF24_PROD_SERVICE_ROLE_KEY = originalRole;
});
