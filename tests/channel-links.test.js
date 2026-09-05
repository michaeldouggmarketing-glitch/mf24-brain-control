import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveChannelIdentity} from '../lib/channel-links.js';

const previous = process.env.MF24_BRAIN_SERVICE_ROLE_KEY;

test('channel identity resolves only by hashed subject', async () => {
  process.env.MF24_BRAIN_SERVICE_ROLE_KEY = 'configured-for-test';
  let payload;
  const identity = await resolveChannelIdentity({
    channel:'whatsapp', externalSubject:'+5531999999999',
    rpcCaller:async (name, args) => {
      assert.equal(name, 'mf24_brain_resolve_channel_link');
      payload = args;
      return [{mf24_user_id:'11111111-1111-1111-1111-111111111111',mf24_space_id:'life',status:'active'}];
    },
  });
  assert.equal(payload.p_channel, 'whatsapp');
  assert.equal(payload.p_external_subject_hash.length, 64);
  assert.equal(JSON.stringify(payload).includes('+5531999999999'), false);
  assert.equal(identity.mf24_space_id, 'life');
});

test('unlinked identity is rejected', async () => {
  process.env.MF24_BRAIN_SERVICE_ROLE_KEY = 'configured-for-test';
  await assert.rejects(
    resolveChannelIdentity({externalSubject:'+5531888888888', rpcCaller:async () => []}),
    error => error.status === 409 && error.message === 'channel_identity_not_linked',
  );
});

test.after(() => {
  if (previous === undefined) delete process.env.MF24_BRAIN_SERVICE_ROLE_KEY;
  else process.env.MF24_BRAIN_SERVICE_ROLE_KEY = previous;
});
