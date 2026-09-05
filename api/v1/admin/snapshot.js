import {handler} from '../../../lib/handler.js';
import {json, method} from '../../../lib/http.js';
import {requireAdmin} from '../../../lib/admin-auth.js';
import {getMF24ProductionSnapshot} from '../../../lib/mf24-prod.js';
import {callBrainAdmin} from '../../../lib/brain-client.js';

async function attempt(fn, missingCode) {
  try { return {ok:true, data:await fn()}; }
  catch (error) { return {ok:false, error:error.message || missingCode}; }
}

export default handler(async (req, res, id) => {
  if (!method(req, res, ['GET'])) return;
  requireAdmin(req);
  const [mf24, brain] = await Promise.all([
    attempt(() => getMF24ProductionSnapshot(), 'mf24_unavailable'),
    attempt(() => callBrainAdmin('admin_overview'), 'brain_admin_unavailable'),
  ]);
  json(res, 200, {
    request_id:id,
    generated_at:new Date().toISOString(),
    integrations:{
      openai:process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
      brain_service_role:process.env.MF24_BRAIN_SERVICE_ROLE_KEY ? 'configured' : 'not_configured',
      mf24_prod_service_role:process.env.MF24_PROD_SERVICE_ROLE_KEY ? 'configured' : 'not_configured',
      n8n:process.env.MF24_N8N_WEBHOOK_URL ? 'configured' : 'not_configured',
    },
    mf24,
    brain,
    privacy:{admin_only:true, secrets_returned:false, raw_financial_text_returned:false},
  });
});
