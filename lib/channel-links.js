import {callBrainRpcAdmin} from './brain-client.js';
import {hash} from './http.js';

export async function resolveChannelIdentity({channel='whatsapp', externalSubject, rpcCaller=callBrainRpcAdmin} = {}) {
  if (!externalSubject) throw Object.assign(new Error('external_subject_required'), {status:400});
  if (!process.env.MF24_BRAIN_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('channel_identity_service_not_configured'), {status:503});
  }
  const subjectHash = hash(externalSubject);
  const rows = await rpcCaller('mf24_brain_resolve_channel_link', {
    p_channel:channel,
    p_external_subject_hash:subjectHash,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.mf24_user_id || row.status !== 'active') {
    throw Object.assign(new Error('channel_identity_not_linked'), {status:409});
  }
  return {
    subject_hash:subjectHash,
    mf24_user_id:row.mf24_user_id,
    mf24_space_id:row.mf24_space_id || null,
    status:row.status,
  };
}
