import {handler} from '../../../lib/handler.js';
import {body, json, method} from '../../../lib/http.js';
import {interpret} from '../../../lib/brain.js';
import {resolveWithBrain} from '../../../lib/brain-client.js';

export default handler(async (req, res, id) => {
  if (!method(req, res)) return;
  if (process.env.MF24_BRAIN_ENABLED === 'false') return json(res, 503, {request_id: id, error: 'brain_disabled', fallback: 'mf24_native'});
  const input = await body(req, 8192);
  const text = String(input.text || '').trim();
  const local = interpret(text, {today: input.today});
  const global = await resolveWithBrain(text);
  json(res, 200, {
    request_id: id,
    source: 'mf24_native_plus_global_brain',
    result: local,
    global_knowledge: {
      confidence: global.confidence,
      suggested_layer: global.suggested_layer,
      entities: global.entities?.candidates || [],
      rules: global.rules?.matches || [],
      latency_ms: global.latency_ms,
    },
    validation: {ledger_written: false, confirmation_required: true},
    privacy: {raw_text_stored: false},
  });
});
