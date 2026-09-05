import {handler} from '../../../../lib/handler.js';
import {body, json, method} from '../../../../lib/http.js';
import {requireApi} from '../../../../lib/api-auth.js';
import {orchestrate} from '../../../../lib/orchestrator.js';
import {claimIdempotency, completeIdempotency} from '../../../../lib/idempotency.js';
import {resolveChannelIdentity} from '../../../../lib/channel-links.js';

export default handler(async (req, res, id) => {
  if (!method(req, res)) return;
  requireApi(req, 'whatsapp:message');
  const input = await body(req);
  if (!input.event_id || !input.phone || !input.timestamp || !['text', 'audio'].includes(input.message_type)) {
    return json(res, 400, {request_id:id, error:'invalid_payload'});
  }
  const eventTime = Date.parse(input.timestamp);
  if (!Number.isFinite(eventTime)) return json(res, 400, {request_id:id, error:'invalid_timestamp'});
  const now = Date.now();
  if (eventTime > now + 300000 || eventTime < now - 172800000) {
    return json(res, 409, {request_id:id, error:'event_outside_replay_window'});
  }
  if (input.message_type === 'text' && (!input.text || String(input.text).length > 4000)) {
    return json(res, 400, {request_id:id, error:'text_required_or_too_long'});
  }

  const claim = await claimIdempotency({eventId:input.event_id, payload:input});
  if (claim.duplicate) {
    return json(res, 200, {request_id:id, duplicate:true, processed:false,
      idempotency_persistence:claim.persistence});
  }

  const identity = await resolveChannelIdentity({channel:'whatsapp', externalSubject:input.phone});
  let response;
  if (input.message_type === 'audio') {
    response = {request_id:id, duplicate:false, processed:false, next:'audio_transcription',
      mf24_user_id:identity.mf24_user_id, mf24_space_id:identity.mf24_space_id,
      subject_hash:identity.subject_hash, requires_openai:!process.env.OPENAI_API_KEY,
      idempotency_persistence:claim.persistence};
  } else {
    const result = await orchestrate(input.text, {channel:'whatsapp'});
    response = {request_id:id, duplicate:false, processed:true, channel:'whatsapp',
      mf24_user_id:identity.mf24_user_id, mf24_space_id:identity.mf24_space_id,
      subject_hash:identity.subject_hash, idempotency_persistence:claim.persistence, ...result,
      validation:{ledger_written:false, confirmation_required:true}};
  }
  await completeIdempotency({idempotencyKey:claim.idempotencyKey, payloadHash:claim.payloadHash, response});
  json(res, input.message_type === 'audio' ? 202 : 200, response);
});
