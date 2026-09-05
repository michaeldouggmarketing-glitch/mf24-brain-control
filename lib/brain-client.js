const DEFAULT_BRAIN_URL = 'https://btedjuicmtxbgxqovotu.supabase.co/functions/v1/mf24-brain-core';
// Supabase publishable keys are intentionally safe for public clients. Privileged
// operations remain protected by the service-role JWT inside the Edge Function.
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_Yc2C9RW6OXUA0uX8LVjKMg_uHBHGoy2';

export async function callBrain(action, payload = {}, {fetchImpl = fetch, timeoutMs = 9000} = {}) {
  const url = process.env.MF24_BRAIN_URL || DEFAULT_BRAIN_URL;
  const key = process.env.MF24_BRAIN_PUBLISHABLE_KEY || process.env.MF24_BRAIN_ANON_KEY || DEFAULT_PUBLISHABLE_KEY;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}`},
    body: JSON.stringify({action, ...payload}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'brain_upstream_error'), {status: 502, upstreamStatus: response.status});
  return data;
}

export const getBrainStatus = options => callBrain('status', {}, options);
export const getPublicMetrics = options => callBrain('public_metrics', {}, options);
export const resolveWithBrain = (text, options) => callBrain('resolve', {text, country: 'BR', limit: 5}, options);

export async function callBrainAdmin(action, payload = {}, {fetchImpl = fetch, timeoutMs = 9000} = {}) {
  const key = process.env.MF24_BRAIN_SERVICE_ROLE_KEY;
  if (!key) throw Object.assign(new Error('brain_service_role_not_configured'), {status: 503});
  const url = process.env.MF24_BRAIN_URL || DEFAULT_BRAIN_URL;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}`},
    body: JSON.stringify({action, ...payload}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'brain_admin_upstream_error'), {status: 502});
  return data;
}
