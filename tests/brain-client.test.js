import test from 'node:test';
import assert from 'node:assert/strict';
import {callBrain, getBrainStatus, resolveWithBrain} from '../lib/brain-client.js';

function response(status, data) {
  return {ok: status >= 200 && status < 300, status, json: async () => data};
}

test('consulta status com chave publicável e JWT bearer', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = {url, options};
    return response(200, {ok: true, version: 4});
  };
  const result = await getBrainStatus({fetchImpl});
  assert.equal(result.version, 4);
  assert.match(request.url, /mf24-brain-core$/);
  assert.match(request.options.headers.apikey, /^sb_publishable_/);
  assert.equal(request.options.headers.authorization, `Bearer ${request.options.headers.apikey}`);
  assert.deepEqual(JSON.parse(request.options.body), {action: 'status'});
});

test('resolve limita o contrato ao país e ao top 5', async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return response(200, {ok: true});
  };
  await resolveWithBrain('gasolina', {fetchImpl});
  assert.deepEqual(body, {action: 'resolve', text: 'gasolina', country: 'BR', limit: 5});
});

test('falha upstream não vaza resposta interna', async () => {
  const fetchImpl = async () => response(500, {});
  await assert.rejects(() => callBrain('status', {}, {fetchImpl}), /brain_upstream_error/);
});
