import {handler} from '../../lib/handler.js';
import {json, method} from '../../lib/http.js';
import {getBrainStatus} from '../../lib/brain-client.js';

export default handler(async (req, res, id) => {
  if (!method(req, res, ['GET'])) return;
  const openai = Boolean(process.env.OPENAI_API_KEY);
  let brain;
  try { brain = await getBrainStatus(); } catch (error) { brain = {error: error.message}; }
  const connected = Boolean(brain?.ok);
  json(res, connected ? 200 : 503, {
    request_id: id,
    status: connected ? 'operational' : 'degraded',
    version: '1.2.0',
    services: {
      api: 'healthy',
      brain_supabase: connected ? 'healthy' : 'unavailable',
      mf24_supabase: connected ? 'healthy_via_brain' : 'unverified',
      openai: openai ? 'configured' : 'not_configured',
      n8n: (process.env.MF24_N8N_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL) ? 'configured' : 'not_configured',
      audio: openai ? 'ready' : 'pending_openai',
    },
    brain: connected ? {edge_version: brain.version, ...brain.status} : {error: brain.error},
    feature_flags: {brain: process.env.MF24_BRAIN_ENABLED !== 'false'},
    privacy: {raw_financial_text_stored: false, raw_audio_retained: false},
  });
});
