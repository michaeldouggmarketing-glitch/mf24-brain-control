import {hash, secureEq} from './http.js';

function credential(req) {
  return String(req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '').trim();
}

function scopes() {
  return new Set(String(process.env.MF24_API_SCOPES || 'brain:interpret,audio:transcribe,whatsapp:message')
    .split(',').map(value => value.trim()).filter(Boolean));
}

export function requireApi(req, scope) {
  const value = credential(req);
  if (!value || !secureEq(hash(value), process.env.MF24_API_KEY_HASH)) {
    throw Object.assign(new Error('unauthorized'), {status:401});
  }
  if (!scopes().has(scope)) throw Object.assign(new Error('forbidden_scope'), {status:403});
  return {role:'api', scope};
}
