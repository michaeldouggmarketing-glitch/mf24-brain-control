import crypto from 'node:crypto';
import {handler} from '../../../lib/handler.js';
import {body, json, method, auth} from '../../../lib/http.js';
import {decodeAudioBase64, fetchAudio, transcribeAudio, validateAudioMeta} from '../../../lib/audio.js';
import {orchestrate} from '../../../lib/orchestrator.js';
import {callBrainAdmin} from '../../../lib/brain-client.js';

function extension(mimeType) {
  return ({'audio/mpeg':'mp3','audio/mp4':'m4a','audio/m4a':'m4a','audio/ogg':'ogg','application/ogg':'ogg','audio/webm':'webm','audio/wav':'wav','audio/x-wav':'wav','audio/aac':'aac','audio/flac':'flac'})[mimeType] || 'audio';
}

async function recordTelemetry(payload) {
  try {
    await callBrainAdmin('record_audio_event', payload);
    return 'recorded';
  } catch (error) {
    if (error.message === 'brain_service_role_not_configured') return 'pending_service_role';
    return 'failed';
  }
}

export default handler(async (req, res, id) => {
  if (!method(req, res)) return;
  auth(req, 'audio:transcribe');
  if (!process.env.OPENAI_API_KEY) {
    return json(res, 503, {request_id:id, error:'openai_not_configured', audio_pipeline:'ready_for_secret', raw_audio_retained:false});
  }

  const maxBytes = Number(process.env.MF24_MAX_AUDIO_BYTES || 15728640);
  const maxDurationSeconds = Number(process.env.MF24_MAX_AUDIO_SECONDS || 300);
  const input = await body(req, Math.ceil(maxBytes * 1.4) + 4096);
  let audio;
  if (input.audio_url) {
    audio = await fetchAudio(input.audio_url, {maxBytes});
  } else if (input.audio_base64) {
    const mimeType = validateAudioMeta({mimeType: input.mime_type, durationMs: input.duration_ms, maxDurationSeconds});
    audio = {bytes: decodeAudioBase64(input.audio_base64, maxBytes), mimeType};
  } else {
    return json(res, 400, {request_id:id, error:'audio_url_or_base64_required'});
  }

  validateAudioMeta({mimeType: audio.mimeType, durationMs: input.duration_ms, maxDurationSeconds});
  const model = process.env.MF24_AUDIO_MODEL || 'gpt-4o-mini-transcribe';
  const started = Date.now();
  const audioHash = crypto.createHash('sha256').update(audio.bytes).digest('hex');

  try {
    const transcript = await transcribeAudio({
      bytes: audio.bytes,
      mimeType: audio.mimeType,
      filename: input.filename || `whatsapp-audio.${extension(audio.mimeType)}`,
      apiKey: process.env.OPENAI_API_KEY,
      model,
    });
    const interpretation = await orchestrate(transcript.text, {channel:input.channel || 'whatsapp'});
    const latencyMs = Date.now() - started;
    const telemetry = await recordTelemetry({
      request_id:id,
      mf24_user_id:typeof input.mf24_user_id === 'string' ? input.mf24_user_id : null,
      mf24_space_id:typeof input.mf24_space_id === 'string' ? input.mf24_space_id : null,
      channel:input.channel || 'whatsapp',
      audio_sha256:audioHash,
      mime_type:audio.mimeType,
      size_bytes:audio.bytes.length,
      duration_ms:input.duration_ms ?? (transcript.duration ? Math.round(Number(transcript.duration) * 1000) : null),
      language:'pt',
      provider:'openai',
      model,
      latency_ms:latencyMs,
      estimated_cost_usd:null,
      success:true,
      metadata:{raw_audio_retained:false, source:input.audio_url ? 'url' : 'base64'},
    });
    json(res, 200, {
      request_id:id,
      transcript:transcript.text,
      interpretation,
      validation:{ledger_written:false, confirmation_required:true},
      telemetry,
      audio:{model, size_bytes:audio.bytes.length, duration_ms:input.duration_ms ?? null, raw_audio_retained:false},
      privacy:{raw_audio_retained:false, raw_financial_text_stored:false, openai_response_stored:false},
    });
  } catch (error) {
    await recordTelemetry({
      request_id:id, channel:input.channel || 'whatsapp', audio_sha256:audioHash,
      mime_type:audio.mimeType, size_bytes:audio.bytes.length, duration_ms:input.duration_ms ?? null,
      language:'pt', provider:'openai', model, latency_ms:Date.now() - started,
      estimated_cost_usd:null, success:false, error_code:error.message,
      metadata:{raw_audio_retained:false},
    });
    throw error;
  }
});
