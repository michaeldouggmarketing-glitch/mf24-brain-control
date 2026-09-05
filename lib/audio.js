import dns from 'node:dns/promises';
import net from 'node:net';

const allowedTypes = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
  'application/ogg',
]);

function privateIp(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const value = address.toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') ||
    value.startsWith('fd') || value.startsWith('fe80:') || value.startsWith('::ffff:127.');
}

export async function assertPublicHttps(rawUrl, {lookup = dns.lookup} = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw Object.assign(new Error('invalid_audio_url'), {status: 400}); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw Object.assign(new Error('audio_url_must_be_public_https'), {status: 400});
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    throw Object.assign(new Error('private_audio_url_rejected'), {status: 400});
  }
  const addresses = net.isIP(url.hostname) ? [{address: url.hostname}] : await lookup(url.hostname, {all: true});
  if (!addresses.length || addresses.some(item => privateIp(item.address))) {
    throw Object.assign(new Error('private_audio_url_rejected'), {status: 400});
  }
  return url;
}

export function decodeAudioBase64(value, maxBytes) {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw Object.assign(new Error('invalid_audio_base64'), {status: 400});
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw Object.assign(new Error('audio_too_large'), {status: 413});
  return bytes;
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('audio_too_large'), {status: 413});
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('audio_too_large'), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function fetchAudio(rawUrl, {maxBytes, fetchImpl = fetch, lookup = dns.lookup} = {}) {
  let url = await assertPublicHttps(rawUrl, {lookup});
  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await fetchImpl(url, {redirect: 'manual', signal: AbortSignal.timeout(15000)});
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 2) throw Object.assign(new Error('audio_redirect_rejected'), {status: 400});
      url = await assertPublicHttps(new URL(location, url).toString(), {lookup});
      continue;
    }
    if (!response.ok) throw Object.assign(new Error('audio_download_failed'), {status: 422});
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!allowedTypes.has(mimeType)) throw Object.assign(new Error('unsupported_audio_type'), {status: 415});
    return {bytes: await readLimited(response, maxBytes), mimeType, sourceUrl: url.toString()};
  }
  throw Object.assign(new Error('audio_download_failed'), {status: 422});
}

export function validateAudioMeta({mimeType, durationMs, maxDurationSeconds}) {
  const type = String(mimeType || '').toLowerCase();
  if (!allowedTypes.has(type)) throw Object.assign(new Error('unsupported_audio_type'), {status: 415});
  if (durationMs != null && (!Number.isFinite(Number(durationMs)) || Number(durationMs) < 0)) {
    throw Object.assign(new Error('invalid_audio_duration'), {status: 400});
  }
  if (Number(durationMs || 0) > maxDurationSeconds * 1000) {
    throw Object.assign(new Error('audio_too_long'), {status: 413});
  }
  return type;
}

export async function transcribeAudio({bytes, mimeType, filename, apiKey, model, fetchImpl = fetch}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], {type: mimeType}), String(filename || 'audio').replace(/[^a-zA-Z0-9._-]/g, '_'));
  form.append('model', model);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {authorization: `Bearer ${apiKey}`},
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('transcription_failed'), {status: 502, upstreamStatus: response.status});
  const text = String(data.text || '').trim();
  if (!text) throw Object.assign(new Error('empty_transcription'), {status: 502});
  return {text, duration: data.duration ?? null};
}
