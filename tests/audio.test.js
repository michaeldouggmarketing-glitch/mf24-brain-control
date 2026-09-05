import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPublicHttps, decodeAudioBase64, validateAudioMeta} from '../lib/audio.js';

test('rejeita URL HTTP e endereços privados', async () => {
  await assert.rejects(() => assertPublicHttps('http://example.com/audio.ogg'), /public_https/);
  await assert.rejects(() => assertPublicHttps('https://127.0.0.1/audio.ogg'), /private_audio_url/);
  await assert.rejects(() => assertPublicHttps('https://example.test/audio.ogg', {lookup:async () => [{address:'10.0.0.2'}]}), /private_audio_url/);
});

test('aceita HTTPS público validado', async () => {
  const url = await assertPublicHttps('https://cdn.example.test/audio.ogg', {lookup:async () => [{address:'203.0.113.20'}]});
  assert.equal(url.protocol, 'https:');
});

test('limita base64, MIME e duração', () => {
  assert.deepEqual(decodeAudioBase64(Buffer.from('audio').toString('base64'), 10), Buffer.from('audio'));
  assert.throws(() => decodeAudioBase64(Buffer.alloc(11).toString('base64'), 10), /audio_too_large/);
  assert.throws(() => validateAudioMeta({mimeType:'text/plain',maxDurationSeconds:300}), /unsupported_audio_type/);
  assert.throws(() => validateAudioMeta({mimeType:'audio/ogg',durationMs:301000,maxDurationSeconds:300}), /audio_too_long/);
});
