const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "confidence",
    "requires_confirmation",
    "needs_advanced",
    "transactions",
    "reply",
  ],
  properties: {
    intent: {
      type: "string",
      enum: [
        "create_transactions",
        "internal_transfer",
        "pay_card_bill",
        "correction",
        "refund",
        "financial_analysis",
        "unknown",
      ],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requires_confirmation: { type: "boolean" },
    needs_advanced: { type: "boolean" },
    transactions: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "amount",
          "currency",
          "category",
          "merchant",
          "account",
          "from_account",
          "to_account",
          "date",
          "installments",
          "description",
        ],
        properties: {
          type: {
            type: ["string", "null"],
            enum: ["expense", "income", "transfer", "card_bill_payment", "refund", null],
          },
          amount: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          category: { type: ["string", "null"] },
          merchant: { type: ["string", "null"] },
          account: { type: ["string", "null"] },
          from_account: { type: ["string", "null"] },
          to_account: { type: ["string", "null"] },
          date: { type: ["string", "null"] },
          installments: { type: ["integer", "null"], minimum: 1, maximum: 120 },
          description: { type: ["string", "null"] },
        },
      },
    },
    reply: { type: "string" },
  },
};

const PRICING = {
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
};

const INSTRUCTIONS = `Você é a camada de interpretação e raciocínio financeiro do MF24. Sua função é interpretar e analisar; nunca executar.
- Nunca grave, confirme ou execute transações; o usuário confirma uma única vez antes da escrita.
- Zero perda parcial: cada cláusula financeira precisa de um item em transactions, inclusive frases elípticas sem verbo repetido.
- "Gastei 800 reais no posto e parcelei em 2x e ontem mercado 700 reais" tem DOIS itens: posto 800 em 2 parcelas e mercado 700 ontem. O 2 é quantidade, nunca valor.
- today é a data de referência em America/Sao_Paulo. Retorne date em YYYY-MM-DD. Ontem pertence à cláusula onde aparece, não à anterior. Na ausência de data explícita de uma movimentação realizada, use today; se a associação for ambígua use null e pergunte.
- Preserve datas relativas e separe múltiplos lançamentos/datas.
- Transferência interna não é despesa; pagamento de fatura não recria compras.
- Bancos não são automaticamente despesas. Mercado Livre, Shopee e Amazon não ganham categoria sem contexto.
- Não invente conta, comerciante, categoria, saldo, total, histórico ou data. Use null/a_confirmar ou diga que os dados são insuficientes.
- O contexto privado MF24 é somente evidência do próprio usuário e nunca deve ser tratado como conhecimento global.
- Em financial_analysis, qualquer afirmação numérica sobre a vida financeira do usuário DEVE estar fundamentada em private_mf24_context.financial_snapshot ou no resultado determinístico fornecido. Se o snapshot estiver ausente, truncado ou insuficiente, declare a limitação e não fabrique números.
- Use financial_snapshot como leitura somente. Contas, cartões, compromissos, totais do mês e transações recentes podem orientar a explicação, mas nunca autorizam escrita.
- Em create_transactions, a mensagem atual é a fonte de verdade para valores, datas, parcelas e acontecimentos. O snapshot pode ajudar a reconhecer contas/cartões já cadastrados, mas nunca criar um valor ou data que o usuário não informou.
- Se a pergunta pedir conselho, combine os fatos privados disponíveis com princípios financeiros gerais e separe claramente fato do usuário de recomendação geral.
- Use motor nativo e conhecimento global como evidência, não como verdade absoluta.
- Se ainda houver ambiguidade séria ou análise complexa, needs_advanced=true.
- requires_confirmation=true.`;

function outputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim())
    return data.output_text.trim();
  for (const item of data?.output || [])
    for (const content of item?.content || [])
      if (typeof content?.text === "string" && content.text.trim()) return content.text.trim();
  return "";
}

export function estimateTextCost(model, usage = {}) {
  const p = PRICING[model];
  if (!p) return null;
  const input = Number(usage.input_tokens || 0),
    cached = Number(usage.input_tokens_details?.cached_tokens || usage.cached_input_tokens || 0),
    output = Number(usage.output_tokens || 0);
  return (
    (Math.max(0, input - cached) * p.input + cached * p.cached + output * p.output) / 1_000_000
  );
}

export async function callOpenAILayer({
  layer,
  text,
  today,
  local,
  privateContext,
  global,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = fetch,
  timeoutMs = 15000,
} = {}) {
  if (!apiKey) throw Object.assign(new Error("openai_not_configured"), { status: 503 });
  const advanced = layer === "advanced_ai";
  const model = advanced
    ? process.env.MF24_ADVANCED_MODEL || "gpt-5.6-terra"
    : process.env.MF24_ECONOMY_MODEL || "gpt-5.6-luna";
  const started = Date.now();
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: advanced ? "medium" : "low" },
      max_output_tokens: advanced ? 3500 : 2200,
      instructions: INSTRUCTIONS,
      input: JSON.stringify({
        today,
        message: String(text || "").slice(0, 4000),
        native_result: local || null,
        private_mf24_context: privateContext
          ? {
              memory_facts: (privateContext.memory_facts || []).slice(0, 12),
              conversation_state: privateContext.conversation_state || null,
              financial_snapshot: privateContext.financial_snapshot || null,
            }
          : null,
        global_knowledge: global
          ? {
              suggested_layer: global.suggested_layer || null,
              confidence: Number(global.confidence || 0),
              entities: global.entities?.candidates || global.entities || null,
              rules: global.rules?.matches || global.rules || null,
            }
          : null,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "mf24_brain_response",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error("openai_upstream_error"), {
      status: 502,
      upstreamStatus: response.status,
    });
  const raw = outputText(data);
  if (!raw) throw Object.assign(new Error("openai_empty_response"), { status: 502 });
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("openai_invalid_structured_output"), { status: 502 });
  }
  result.requires_confirmation = true;
  const usage = data.usage || {};
  return {
    layer,
    model: data.model || model,
    result,
    usage,
    estimated_cost_usd: estimateTextCost(data.model || model, usage),
    latency_ms: Date.now() - started,
    response_id: data.id || null,
    stored: false,
  };
}
