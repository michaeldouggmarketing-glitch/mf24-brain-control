import {callBrainAdmin} from './brain-client.js';
import {hash} from './http.js';

const ephemeral = new Map();
const CLIENT_KEY = 'mf24-brain-control-whatsapp';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(payload) {
  return hash(stableJson(payload));
}

export async function claimIdempotency({eventId, payload, callAdmin = callBrainAdmin, memory = ephemeral}) {
  const idempotencyKey = hash(eventId);
  const payloadHash = requestHash(payload);
  if (!process.env.MF24_BRAIN_SERVICE_ROLE_KEY) {
    const existing = memory.get(idempotencyKey);
    if (existing && existing.requestHash !== payloadHash) {
      throw Object.assign(new Error('idempotency_payload_mismatch'), {status:409});
    }
    if (existing) return {claimed:false, duplicate:true, persistence:'ephemeral', idempotencyKey, payloadHash};
    memory.set(idempotencyKey, {requestHash:payloadHash, expiresAt:Date.now() + 86400000});
    return {claimed:true, duplicate:false, persistence:'ephemeral', idempotencyKey, payloadHash};
  }
  const result = await callAdmin('claim_idempotency', {
    client_key: CLIENT_KEY,
    idempotency_key: idempotencyKey,
    request_hash: payloadHash,
    ttl_seconds: 86400,
  });
  return {claimed:result.claimed === true, duplicate:result.duplicate === true,
    persistence:'supabase', idempotencyKey, payloadHash};
}

export async function completeIdempotency({idempotencyKey, payloadHash, response, callAdmin = callBrainAdmin}) {
  if (!process.env.MF24_BRAIN_SERVICE_ROLE_KEY) return {persistence:'ephemeral'};
  await callAdmin('complete_idempotency', {
    client_key: CLIENT_KEY,
    idempotency_key: idempotencyKey,
    request_hash: payloadHash,
    response_hash: hash(stableJson(response)),
  });
  return {persistence:'supabase'};
}
