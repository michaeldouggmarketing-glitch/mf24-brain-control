import {handler} from '../../../../lib/handler.js';
import {body, json, method, auth, hash} from '../../../../lib/http.js';
import {interpret} from '../../../../lib/brain.js';
import {claimIdempotency, completeIdempotency} from '../../../../lib/idempotency.js';

export default handler(async (req, res, id) => {
  if (!method(req, res)) return;
  auth(req, 'whatsapp:message');
  const input = await body(req);
  if (!input.event_id || !input.phone || !['text', 'audio'].includes(input.message_type)) {
    return json(res, 400, {request_id:id, error:'invalid_payload'});
  }

  const claim = await claimIdempotency({eventId:input.event_id, payload:input});
  if (claim.duplicate) {
    return json(res, 200, {request_id:id, duplicate:true, processed:false,
      idempotency_persistence:claim.persistence});
  }

  const response = input.message_type === 'audio'
    ? {request_id:id, duplicate:false, processed:false, next:'audio_transcription',
      requires_openai:!process.env.OPENAI_API_KEY, idempotency_persistence:claim.persistence}
    : {request_id:id, duplicate:false, processed:true, channel:'whatsapp',
      subject_hash:hash(input.phone), idempotency_persistence:claim.persistence, ...interpret(input.text)};
  await completeIdempotency({idempotencyKey:claim.idempotencyKey, payloadHash:claim.payloadHash, response});
  json(res, input.message_type === 'audio' ? 202 : 200, response);
});
