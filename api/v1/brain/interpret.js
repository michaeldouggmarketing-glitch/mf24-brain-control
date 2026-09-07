import {handler} from '../../../lib/handler.js';
import {body, json, method} from '../../../lib/http.js';
import {requireApi} from '../../../lib/api-auth.js';
import {authenticateMf24AppUser} from '../../../lib/mf24-user-auth.js';
import {orchestrate} from '../../../lib/orchestrator.js';

export default handler(async (req, res, id) => {
  if (!method(req, res)) return;
  if (process.env.MF24_BRAIN_ENABLED === 'false') {
    return json(res, 503, {request_id:id, error:'brain_disabled', fallback:'mf24_native'});
  }

  const input = await body(req, 8192);
  const requestedSpaceId = typeof input.mf24_space_id === 'string' ? input.mf24_space_id : null;
  let mf24UserId = typeof input.mf24_user_id === 'string' ? input.mf24_user_id : null;
  let mf24SpaceId = requestedSpaceId;
  let caller = 'service_api';

  // Existing service integrations keep using the hashed API credential. The
  // MF24 web app may instead forward the user's own Supabase access token. In
  // that path the Brain independently validates the token and workspace, and
  // never trusts a browser-supplied user id.
  try {
    requireApi(req, 'brain:interpret');
  } catch (error) {
    if (req.headers['x-api-key']) throw error;
    const verified = await authenticateMf24AppUser(req, {spaceId:requestedSpaceId});
    if (input.scope && input.scope !== verified.spaceType) {
      throw Object.assign(new Error('workspace_scope_mismatch'), {status:403});
    }
    mf24UserId = verified.userId;
    mf24SpaceId = verified.spaceId;
    caller = 'mf24_user_session';
  }

  const out = await orchestrate(input.text, {
    today:input.today,
    channel:input.channel || 'api',
    mf24UserId,
    mf24SpaceId,
  });
  json(res, 200, {
    request_id:id,
    ...out,
    validation:{ledger_written:false, confirmation_required:true},
    auth:{caller},
    privacy:{raw_text_stored:false, openai_response_stored:false, private_memory_promoted_to_global:false},
  });
});
