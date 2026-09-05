import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../lib/http.js';
import {requireApi} from '../lib/api-auth.js';
import {requireAdmin} from '../lib/admin-auth.js';

function req(headers={}) { return {headers}; }

test('operational API key is scoped and does not authenticate admin', () => {
  const apiKey = 'api-test-key';
  const adminKey = 'admin-test-key';
  const previous = {
    api:process.env.MF24_API_KEY_HASH,
    admin:process.env.MF24_ADMIN_TOKEN_HASH,
    scopes:process.env.MF24_API_SCOPES,
  };
  process.env.MF24_API_KEY_HASH = hash(apiKey);
  process.env.MF24_ADMIN_TOKEN_HASH = hash(adminKey);
  process.env.MF24_API_SCOPES = 'brain:interpret';
  try {
    assert.equal(requireApi(req({'x-api-key':apiKey}), 'brain:interpret').role, 'api');
    assert.throws(() => requireApi(req({'x-api-key':apiKey}), 'audio:transcribe'), error => error.status === 403);
    assert.throws(() => requireAdmin(req({'x-admin-key':apiKey})), error => error.status === 401);
    assert.equal(requireAdmin(req({'x-admin-key':adminKey})).role, 'admin');
  } finally {
    if (previous.api === undefined) delete process.env.MF24_API_KEY_HASH; else process.env.MF24_API_KEY_HASH = previous.api;
    if (previous.admin === undefined) delete process.env.MF24_ADMIN_TOKEN_HASH; else process.env.MF24_ADMIN_TOKEN_HASH = previous.admin;
    if (previous.scopes === undefined) delete process.env.MF24_API_SCOPES; else process.env.MF24_API_SCOPES = previous.scopes;
  }
});
