import {hash, secureEq} from './http.js';

export function requireAdmin(req) {
  const value = String(req.headers['x-admin-key'] || '').trim();
  if (!value || !secureEq(hash(value), process.env.MF24_ADMIN_TOKEN_HASH)) {
    throw Object.assign(new Error('admin_unauthorized'), {status:401});
  }
  return {role:'admin'};
}
