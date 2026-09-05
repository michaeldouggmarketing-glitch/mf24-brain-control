import {handler} from '../../../lib/handler.js';
import {body, json, method, auth} from '../../../lib/http.js';
import {orchestrate} from '../../../lib/orchestrator.js';

export default handler(async (req, res, id) => {
  if (!method(req, res)) return;
  auth(req, 'brain:interpret');
  if (process.env.MF24_BRAIN_ENABLED === 'false') {
    return json(res, 503, {request_id:id, error:'brain_disabled', fallback:'mf24_native'});
  }
  const input = await body(req, 8192);
  const out = await orchestrate(input.text, {today:input.today, channel:input.channel || 'api'});
  json(res, 200, {
    request_id:id,
    ...out,
    validation:{ledger_written:false, confirmation_required:true},
    privacy:{raw_text_stored:false, openai_response_stored:false},
  });
});
