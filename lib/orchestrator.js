import {interpret} from './brain.js';
import {resolveWithBrain, callBrainRpcAdmin} from './brain-client.js';
import {callOpenAILayer} from './openai.js';
import {getMF24PrivateContext} from './mf24-prod.js';
import {hash} from './http.js';

function compactGlobal(global) {
  if (!global) return null;
  return {
    suggested_layer:global.suggested_layer || null,
    confidence:Number(global.confidence || 0),
    entities:global.entities?.candidates || global.entities || null,
    rules:global.rules?.matches || global.rules || null,
    latency_ms:global.latency_ms ?? null,
  };
}

function privateStatus(context, state='unavailable') {
  if (!context) return {used:false,status:state,memory_facts:0,conversation_state:false};
  return {
    used:true,
    status:'loaded_from_mf24_prod',
    memory_facts:Array.isArray(context.memory_facts) ? context.memory_facts.length : 0,
    conversation_state:Boolean(context.conversation_state),
    promoted_to_global:false,
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalise(result, layer) {
  const value = result && typeof result === 'object' ? result : {};
  return {
    intent:typeof value.intent === 'string' ? value.intent : 'unknown',
    resolution_layer:layer,
    confidence:Math.max(0, Math.min(1, safeNumber(value.confidence, 0))),
    requires_confirmation:true,
    transactions:Array.isArray(value.transactions) ? value.transactions.slice(0,20) : [],
    reply:typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : 'Confira os dados antes de confirmar.',
  };
}

async function recordAiUsage({text, channel, call, output}) {
  try {
    const result = output.result || {};
    const requestId = await call('mf24_brain_log_resolution', {
      p_input_hash:hash(text),
      p_intent:result.intent || null,
      p_resolution_layer:output.layer,
      p_confidence:safeNumber(result.confidence, 0) || null,
      p_required_confirmation:true,
      p_success:true,
      p_metadata:{channel, provider:'openai', model:output.model, raw_text_stored:false, openai_response_stored:false},
    });
    if (typeof requestId === 'string' && requestId) {
      const usage = output.usage || {};
      await call('mf24_brain_record_usage', {
        p_request_id:requestId,
        p_resolution_layer:output.layer,
        p_provider:'openai',
        p_model:output.model,
        p_input_tokens:Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
        p_output_tokens:Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
        p_cached_input_tokens:Number.isFinite(Number(usage.input_tokens_details?.cached_tokens)) ? Number(usage.input_tokens_details.cached_tokens) : null,
        p_estimated_cost_usd:Number.isFinite(Number(output.estimated_cost_usd)) ? Number(output.estimated_cost_usd) : null,
        p_latency_ms:Number.isFinite(Number(output.latency_ms)) ? Number(output.latency_ms) : null,
        p_resolved_without_ai:false,
        p_success:true,
        p_error_code:null,
      });
    }
    return 'recorded';
  } catch (error) {
    return error.message === 'brain_service_role_not_configured' ? 'pending_service_role' : 'failed';
  }
}

export async function orchestrate(text, {
  today = new Date().toISOString().slice(0,10),
  channel = 'api',
  mf24UserId = null,
  mf24SpaceId = null,
  nativeInterpreter = interpret,
  resolver = resolveWithBrain,
  privateContextLoader = getMF24PrivateContext,
  aiCaller = callOpenAILayer,
  rpcCaller = callBrainRpcAdmin,
  apiKey = process.env.OPENAI_API_KEY,
} = {}) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 4000) throw Object.assign(new Error('text_required_or_too_long'), {status:400});

  const local = nativeInterpreter(raw, {today});
  let privateContext = null;
  let privateContextState = mf24UserId ? 'unavailable' : 'not_requested';
  if (mf24UserId) {
    try {
      privateContext = await privateContextLoader({userId:mf24UserId, spaceId:mf24SpaceId || undefined});
      privateContextState = 'loaded_from_mf24_prod';
    } catch (error) {
      if (error.status === 400) throw error;
      privateContextState = error.message === 'mf24_prod_service_role_not_configured' ? 'not_configured' : 'temporarily_unavailable';
    }
  }

  let global = null;
  try { global = await resolver(raw); } catch { global = null; }
  const globalConfidence = safeNumber(global?.confidence, 0);
  const globalLayer = global?.suggested_layer;
  const contextStatus = privateStatus(privateContext, privateContextState);

  // Native and global knowledge get first refusal. OpenAI is an amplifier/fallback.
  if (safeNumber(local.confidence, 0) >= 0.90 && local.resolution_layer !== 'economy_ai') {
    return {
      ...normalise(local, local.resolution_layer),
      private_memory:contextStatus,
      global_knowledge:compactGlobal(global),
      openai:{used:false, status:apiKey ? 'available_not_needed' : 'not_configured'},
      telemetry:'native_or_global',
    };
  }
  if (global && ['deterministic','global_knowledge'].includes(globalLayer) && globalConfidence >= 0.92 && local.transactions?.length) {
    return {
      ...normalise({...local, confidence:Math.max(safeNumber(local.confidence,0), globalConfidence)}, globalLayer),
      private_memory:contextStatus,
      global_knowledge:compactGlobal(global),
      openai:{used:false, status:apiKey ? 'available_not_needed' : 'not_configured'},
      telemetry:'native_or_global',
    };
  }

  if (!apiKey) {
    return {
      ...normalise(local, 'economy_ai'),
      private_memory:contextStatus,
      global_knowledge:compactGlobal(global),
      openai:{used:false, status:'not_configured', next_layer:'economy_ai'},
      telemetry:'blocked_by_openai_secret',
    };
  }

  const economy = await aiCaller({layer:'economy_ai', text:raw, today, local, privateContext, global, apiKey});
  const economyResult = normalise(economy.result, 'economy_ai');
  const economyTelemetry = await recordAiUsage({text:raw, channel, call:rpcCaller, output:economy});
  const needsAdvanced = economy.result?.needs_advanced === true || economyResult.confidence < 0.65;
  if (!needsAdvanced) {
    return {
      ...economyResult,
      private_memory:contextStatus,
      global_knowledge:compactGlobal(global),
      openai:{used:true, layer:'economy_ai', model:economy.model, usage:economy.usage, estimated_cost_usd:economy.estimated_cost_usd, stored:false},
      telemetry:economyTelemetry,
    };
  }

  try {
    const advanced = await aiCaller({layer:'advanced_ai', text:raw, today, local:economyResult, privateContext, global, apiKey});
    const advancedTelemetry = await recordAiUsage({text:raw, channel, call:rpcCaller, output:advanced});
    return {
      ...normalise(advanced.result, 'advanced_ai'),
      private_memory:contextStatus,
      global_knowledge:compactGlobal(global),
      openai:{used:true, layer:'advanced_ai', model:advanced.model, usage:advanced.usage, estimated_cost_usd:advanced.estimated_cost_usd, stored:false, escalated_from:'economy_ai'},
      telemetry:advancedTelemetry,
    };
  } catch (error) {
    return {
      ...economyResult,
      private_memory:contextStatus,
      global_knowledge:compactGlobal(global),
      openai:{used:true, layer:'economy_ai', model:economy.model, stored:false, advanced_fallback_error:'advanced_ai_unavailable'},
      telemetry:economyTelemetry,
    };
  }
}
