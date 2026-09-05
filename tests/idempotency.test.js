import test from 'node:test';
import assert from 'node:assert/strict';
import {claimIdempotency, completeIdempotency, requestHash, stableJson} from '../lib/idempotency.js';

test('hash do payload independe da ordem das chaves', () => {
  assert.equal(stableJson({b:2,a:1}), stableJson({a:1,b:2}));
  assert.equal(requestHash({b:2,a:1}), requestHash({a:1,b:2}));
});

test('fallback em memória identifica retry e conflito', async () => {
  const previous = process.env.MF24_BRAIN_SERVICE_ROLE_KEY;
  delete process.env.MF24_BRAIN_SERVICE_ROLE_KEY;
  const memory = new Map();
  try {
    assert.equal((await claimIdempotency({eventId:'evt-1', payload:{amount:10}, memory})).claimed, true);
    assert.equal((await claimIdempotency({eventId:'evt-1', payload:{amount:10}, memory})).duplicate, true);
    await assert.rejects(() => claimIdempotency({eventId:'evt-1', payload:{amount:11}, memory}), /payload_mismatch/);
  } finally {
    if (previous) process.env.MF24_BRAIN_SERVICE_ROLE_KEY = previous;
  }
});

test('modo persistente chama claim e complete no Brain', async () => {
  const previous = process.env.MF24_BRAIN_SERVICE_ROLE_KEY;
  process.env.MF24_BRAIN_SERVICE_ROLE_KEY = 'test-service-role';
  const calls = [];
  const callAdmin = async (action, payload) => {
    calls.push({action, payload});
    return action === 'claim_idempotency' ? {claimed:true, duplicate:false} : {completed:true};
  };
  try {
    const claim = await claimIdempotency({eventId:'evt-2', payload:{phone:'hash-me'}, callAdmin});
    assert.equal(claim.persistence, 'supabase');
    await completeIdempotency({idempotencyKey:claim.idempotencyKey, payloadHash:claim.payloadHash,
      response:{processed:true}, callAdmin});
    assert.deepEqual(calls.map(call => call.action), ['claim_idempotency', 'complete_idempotency']);
    assert.equal(calls[1].payload.response_hash.length, 64);
  } finally {
    if (previous) process.env.MF24_BRAIN_SERVICE_ROLE_KEY = previous;
    else delete process.env.MF24_BRAIN_SERVICE_ROLE_KEY;
  }
});
