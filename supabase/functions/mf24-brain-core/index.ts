import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function jwtRole(header: string | null): string | null {
  try {
    if (!header?.startsWith("Bearer ")) return null;
    const payload = header.slice(7).split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function candidatesFrom(data: unknown): any[] {
  if (!data || typeof data !== "object") return [];
  const row = Array.isArray(data) ? data[0] : data;
  if (row && typeof row === "object") {
    const direct = (row as any).candidates;
    if (Array.isArray(direct)) return direct;
    const wrapped = Object.values(row as Record<string, unknown>).find((value: any) => value && typeof value === "object" && Array.isArray(value.candidates)) as any;
    if (wrapped?.candidates) return wrapped.candidates;
  }
  return [];
}

function requiredString(body: Record<string, unknown>, key: string, max: number) {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  return value && value.length <= max ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "brain_backend_not_configured" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = String(body.action ?? "status");
  const isAdmin = jwtRole(req.headers.get("authorization")) === "service_role";
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (action === "status" || action === "health") {
      const { data, error } = await db.rpc("mf24_brain_get_status");
      if (error) throw error;
      return json({ ok: true, service: "mf24-brain-core", version: 5, status: data });
    }

    if (action === "resolve") {
      const started = Date.now();
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 1000) return json({ error: "text_required_or_too_long" }, 400);
      const country = typeof body.country === "string" ? body.country.slice(0, 2).toUpperCase() : "BR";
      const limit = Math.max(1, Math.min(Number(body.limit ?? 5) || 5, 10));
      const [entityResult, ruleResult] = await Promise.all([
        db.rpc("mf24_brain_resolve_entity", { p_text: text, p_country_code: country, p_limit: limit }),
        db.rpc("mf24_brain_match_rules", { p_text: text }),
      ]);
      if (entityResult.error) throw entityResult.error;
      if (ruleResult.error) throw ruleResult.error;
      const candidates = candidatesFrom(entityResult.data);
      const top = candidates[0] ?? null;
      const confidence = typeof top?.confidence === "number" ? top.confidence : Number(top?.confidence ?? 0) || 0;
      const hasRules = Array.isArray(ruleResult.data) ? ruleResult.data.length > 0 : Boolean(ruleResult.data);
      const resolutionLayer = hasRules ? "deterministic" : confidence >= 0.92 ? "global_knowledge" : "economy_ai";
      const requiredConfirmation = resolutionLayer === "economy_ai" || confidence < 0.97;
      const inputHash = await sha256Hex(text);
      const latencyMs = Date.now() - started;
      let requestId: string | null = null;
      const logResult = await db.rpc("mf24_brain_log_resolution", {
        p_input_hash: inputHash,
        p_intent: typeof body.intent === "string" ? body.intent : null,
        p_resolution_layer: resolutionLayer,
        p_confidence: confidence || null,
        p_required_confirmation: requiredConfirmation,
        p_success: true,
        p_metadata: { country, channel: body.channel ?? "api", raw_text_stored: false },
      });
      if (!logResult.error && typeof logResult.data === "string") requestId = logResult.data;
      if (requestId) {
        await db.rpc("mf24_brain_record_usage", {
          p_request_id: requestId, p_resolution_layer: resolutionLayer, p_provider: null, p_model: null,
          p_input_tokens: null, p_output_tokens: null, p_cached_input_tokens: null,
          p_estimated_cost_usd: 0, p_latency_ms: latencyMs,
          p_resolved_without_ai: resolutionLayer === "deterministic" || resolutionLayer === "global_knowledge",
          p_success: true, p_error_code: null,
        });
      }
      return json({ ok: true, request_id: requestId, suggested_layer: resolutionLayer,
        required_confirmation: requiredConfirmation, confidence, entities: entityResult.data,
        rules: ruleResult.data, privacy: { raw_text_stored: false }, latency_ms: latencyMs });
    }

    if (action === "public_metrics") {
      const [overviewResult, inventoryResult] = await Promise.all([
        db.rpc("mf24_brain_admin_overview"), db.rpc("mf24_brain_public_metrics"),
      ]);
      if (overviewResult.error) throw overviewResult.error;
      if (inventoryResult.error) throw inventoryResult.error;
      const overview = Array.isArray(overviewResult.data) ? overviewResult.data[0] : overviewResult.data;
      const system = overview?.system ?? {};
      return json({ ok: true, generated_at: new Date().toISOString(), metrics: {
        inventory: inventoryResult.data ?? {}, runtime: overview?.runtime ?? {},
        services: overview?.services ?? [], layers: overview?.layers ?? [],
        system: { brain_enabled: system.brain_enabled ?? null, learning_enabled: system.learning_enabled ?? null,
          auto_promote_enabled: system.auto_promote_enabled ?? null, privacy_mode: system.privacy_mode ?? null,
          store_raw_user_text: system.store_raw_user_text ?? null },
      }});
    }

    if (action === "admin_overview") {
      if (!isAdmin) return json({ error: "admin_required" }, 403);
      const { data, error } = await db.rpc("mf24_brain_admin_overview");
      if (error) throw error;
      return json({ ok: true, overview: data });
    }

    if (action === "record_audio_event") {
      if (!isAdmin) return json({ error: "admin_required" }, 403);
      const { data, error } = await db.rpc("mf24_brain_record_audio_event", {
        p_request_id: typeof body.request_id === "string" ? body.request_id : null,
        p_mf24_user_id: typeof body.mf24_user_id === "string" ? body.mf24_user_id : null,
        p_mf24_space_id: typeof body.mf24_space_id === "string" ? body.mf24_space_id : null,
        p_channel: typeof body.channel === "string" ? body.channel : "web",
        p_audio_sha256: typeof body.audio_sha256 === "string" ? body.audio_sha256 : null,
        p_mime_type: typeof body.mime_type === "string" ? body.mime_type : null,
        p_size_bytes: Number.isFinite(Number(body.size_bytes)) ? Number(body.size_bytes) : null,
        p_duration_ms: Number.isFinite(Number(body.duration_ms)) ? Number(body.duration_ms) : null,
        p_language: typeof body.language === "string" ? body.language : null,
        p_provider: typeof body.provider === "string" ? body.provider : null,
        p_model: typeof body.model === "string" ? body.model : null,
        p_latency_ms: Number.isFinite(Number(body.latency_ms)) ? Number(body.latency_ms) : null,
        p_estimated_cost_usd: Number.isFinite(Number(body.estimated_cost_usd)) ? Number(body.estimated_cost_usd) : null,
        p_success: body.success !== false,
        p_error_code: typeof body.error_code === "string" ? body.error_code : null,
        p_metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      });
      if (error) throw error;
      return json({ ok: true, audio_event_id: data });
    }

    if (action === "claim_idempotency" || action === "complete_idempotency") {
      if (!isAdmin) return json({ error: "admin_required" }, 403);
      const clientKey = requiredString(body, "client_key", 120);
      const idempotencyKey = requiredString(body, "idempotency_key", 200);
      const requestHash = requiredString(body, "request_hash", 64);
      if (!clientKey || !idempotencyKey || !requestHash) return json({ error: "invalid_idempotency_fields" }, 400);
      const { data: client, error: clientError } = await db.schema("mf24_brain").from("api_clients")
        .select("id").eq("client_key", clientKey).eq("active", true).maybeSingle();
      if (clientError) throw clientError;
      if (!client) return json({ error: "idempotency_client_not_found" }, 404);

      if (action === "claim_idempotency") {
        const ttlSeconds = Math.max(60, Math.min(Number(body.ttl_seconds ?? 86400) || 86400, 604800));
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        const { data: inserted, error: insertError } = await db.schema("mf24_brain").from("idempotency_keys")
          .insert({ client_id: client.id, idempotency_key: idempotencyKey, request_hash: requestHash,
            status: "processing", expires_at: expiresAt })
          .select("id,status,request_hash,response_hash,expires_at").single();
        if (!insertError) return json({ ok: true, claimed: true, duplicate: false, record: inserted });
        if (insertError.code !== "23505") throw insertError;
        const { data: existing, error: existingError } = await db.schema("mf24_brain").from("idempotency_keys")
          .select("id,status,request_hash,response_hash,expires_at")
          .eq("client_id", client.id).eq("idempotency_key", idempotencyKey).single();
        if (existingError) throw existingError;
        if (existing.request_hash && existing.request_hash !== requestHash) return json({ error: "idempotency_payload_mismatch" }, 409);
        if (Date.parse(existing.expires_at) <= Date.now()) {
          const { data: recycled, error: recycleError } = await db.schema("mf24_brain").from("idempotency_keys")
            .update({ request_hash: requestHash, response_hash: null, status: "processing", expires_at: expiresAt,
              updated_at: new Date().toISOString() })
            .eq("id", existing.id).lte("expires_at", new Date().toISOString())
            .select("id,status,request_hash,response_hash,expires_at").maybeSingle();
          if (recycleError) throw recycleError;
          if (recycled) return json({ ok: true, claimed: true, duplicate: false, recycled: true, record: recycled });
        }
        return json({ ok: true, claimed: false, duplicate: true, record: existing });
      }

      const responseHash = requiredString(body, "response_hash", 64);
      if (!responseHash) return json({ error: "invalid_response_hash" }, 400);
      const { data: completed, error: completeError } = await db.schema("mf24_brain").from("idempotency_keys")
        .update({ status: "completed", response_hash: responseHash, updated_at: new Date().toISOString() })
        .eq("client_id", client.id).eq("idempotency_key", idempotencyKey).eq("request_hash", requestHash)
        .select("id,status,response_hash").maybeSingle();
      if (completeError) throw completeError;
      if (!completed) return json({ error: "idempotency_claim_not_found" }, 404);
      return json({ ok: true, completed: true, record: completed });
    }

    if (action === "upsert_channel_link") {
      if (!isAdmin) return json({ error: "admin_required" }, 403);
      const userId = typeof body.mf24_user_id === "string" ? body.mf24_user_id : "";
      const subjectHash = typeof body.external_subject_hash === "string" ? body.external_subject_hash : "";
      const channel = typeof body.channel === "string" ? body.channel : "";
      if (!userId || !subjectHash || !channel) return json({ error: "missing_channel_link_fields" }, 400);
      const { data, error } = await db.rpc("mf24_brain_upsert_channel_link", {
        p_mf24_user_id: userId, p_mf24_space_id: typeof body.mf24_space_id === "string" ? body.mf24_space_id : null,
        p_channel: channel, p_external_subject_hash: subjectHash,
        p_status: typeof body.status === "string" ? body.status : "active",
        p_metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      });
      if (error) throw error;
      return json({ ok: true, channel_link_id: data });
    }

    if (action === "set_brain_enabled") {
      if (!isAdmin) return json({ error: "admin_required" }, 403);
      const { data, error } = await db.rpc("mf24_brain_set_enabled", { p_enabled: body.enabled === true });
      if (error) throw error;
      return json({ ok: true, status: data });
    }

    if (action === "set_layer_enabled") {
      if (!isAdmin) return json({ error: "admin_required" }, 403);
      const layer = typeof body.layer === "string" ? body.layer : "";
      const allowed = new Set(["deterministic", "global_knowledge", "economy_ai", "advanced_ai"]);
      if (!allowed.has(layer)) return json({ error: "invalid_layer" }, 400);
      const { data, error } = await db.rpc("mf24_brain_set_layer_enabled", { p_layer_key: layer, p_enabled: body.enabled === true });
      if (error) throw error;
      return json({ ok: true, status: data });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("mf24-brain-core error", error);
    return json({ error: "brain_internal_error" }, 500);
  }
});
