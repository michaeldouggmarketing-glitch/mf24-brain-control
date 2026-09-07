import test from "node:test";
import assert from "node:assert/strict";
import { orchestrate } from "../lib/orchestrator.js";

const globalEmpty = async () => ({
  suggested_layer: "economy_ai",
  confidence: 0,
  entities: { candidates: [] },
  rules: { matches: [] },
});
const rpcCaller = async () => null;

test("known native transaction does not spend OpenAI", async () => {
  let calls = 0;
  const result = await orchestrate("Gastei 100 de gasolina no Ipiranga hoje", {
    today: "2026-09-05",
    apiKey: "configured",
    resolver: globalEmpty,
    rpcCaller,
    aiCaller: async () => {
      calls++;
      throw new Error("should_not_call");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.resolution_layer, "deterministic");
  assert.equal(result.transactions[0].category, "combustivel");
  assert.equal(result.openai.used, false);
});

test("unknown merchant escalates to economy OpenAI", async () => {
  const layers = [];
  const result = await orchestrate("Gastei 70 na Loja XPTQ", {
    today: "2026-09-05",
    apiKey: "configured",
    resolver: globalEmpty,
    rpcCaller,
    aiCaller: async ({ layer }) => {
      layers.push(layer);
      return {
        layer,
        model: "gpt-5.6-luna",
        usage: { input_tokens: 10, output_tokens: 10 },
        estimated_cost_usd: 0.000014,
        latency_ms: 10,
        result: {
          intent: "create_transactions",
          confidence: 0.82,
          requires_confirmation: true,
          needs_advanced: false,
          transactions: [
            {
              type: "expense",
              amount: 70,
              currency: "BRL",
              category: "a_confirmar",
              merchant: "Loja XPTQ",
              account: null,
              from_account: null,
              to_account: null,
              date: "2026-09-05",
              installments: null,
              description: null,
            },
          ],
          reply: "Confira e confirme.",
        },
      };
    },
  });
  assert.deepEqual(layers, ["economy_ai"]);
  assert.equal(result.resolution_layer, "economy_ai");
  assert.equal(result.openai.model, "gpt-5.6-luna");
  assert.equal(result.requires_confirmation, true);
});

test("serious ambiguity escalates economy to advanced", async () => {
  const layers = [];
  const result = await orchestrate(
    "Analise esta movimentação ambígua e diga o tratamento correto",
    {
      today: "2026-09-05",
      apiKey: "configured",
      resolver: globalEmpty,
      rpcCaller,
      nativeInterpreter: () => ({
        intent: "unknown",
        resolution_layer: "economy_ai",
        confidence: 0.2,
        requires_confirmation: true,
        transactions: [],
        reply: "Preciso de IA.",
      }),
      aiCaller: async ({ layer }) => {
        layers.push(layer);
        if (layer === "economy_ai")
          return {
            layer,
            model: "gpt-5.6-luna",
            usage: {},
            estimated_cost_usd: 0,
            latency_ms: 3,
            result: {
              intent: "unknown",
              confidence: 0.4,
              requires_confirmation: true,
              needs_advanced: true,
              transactions: [],
              reply: "Ambíguo.",
            },
          };
        return {
          layer,
          model: "gpt-5.6-terra",
          usage: {},
          estimated_cost_usd: 0,
          latency_ms: 5,
          result: {
            intent: "financial_analysis",
            confidence: 0.91,
            requires_confirmation: true,
            needs_advanced: false,
            transactions: [],
            reply: "Análise concluída sem executar nada.",
          },
        };
      },
    },
  );
  assert.deepEqual(layers, ["economy_ai", "advanced_ai"]);
  assert.equal(result.resolution_layer, "advanced_ai");
  assert.equal(result.openai.model, "gpt-5.6-terra");
});

test("missing OpenAI secret preserves safe fallback", async () => {
  const result = await orchestrate("Gastei 70 na Loja XPTQ", {
    today: "2026-09-05",
    apiKey: "",
    resolver: globalEmpty,
    rpcCaller,
  });
  assert.equal(result.openai.status, "not_configured");
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.transactions[0].category, "a_confirmar");
});

test("complex narration cannot be short-circuited by confident partial native output", async () => {
  const layers = [];
  const transactions = [{ type: "expense", amount: 800 }, { type: "expense", amount: 700 }];
  const output = await orchestrate(
    "Gastei 800 reais no posto e parcelei em 2x e ontem mercado 700 reais",
    {
      today: "2026-09-07",
      apiKey: "test-configured",
      resolver: globalEmpty,
      rpcCaller,
      nativeInterpreter: () => ({
        intent: "create_transactions",
        confidence: 1,
        resolution_layer: "deterministic",
        transactions: transactions.slice(0, 1),
      }),
      aiCaller: async ({ layer }) => {
        layers.push(layer);
        return {
          layer,
          model: "test-model",
          result: {
            intent: "create_transactions",
            confidence: 0.95,
            transactions: layer === "economy_ai" ? transactions.slice(0, 1) : transactions,
            reply: "Revise",
            needs_advanced: false,
          },
        };
      },
    },
  );
  assert.deepEqual(layers, ["economy_ai", "advanced_ai"]);
  assert.equal(output.transactions.length, 2);
  assert.equal(output.requires_confirmation, true);
});

test("passes date-scoped private ledger snapshot into AI without exposing it globally", async () => {
  let loaderArgs;
  let aiPrivateContext;
  const snapshot = {
    as_of: "2026-09-07",
    month: { expense_minor: 245000, income_minor: 400000, result_minor: 155000 },
    recent_transactions: [{ transaction_id: "tx-1", amount_minor: 70000 }],
    accounts: [{ account_id: "acc-1", name: "Nubank", known_balance_minor: 123400 }],
    cards: [],
    commitments: [],
  };

  const output = await orchestrate("Analise minha situação e me recomende prioridades", {
    today: "2026-09-07",
    mf24UserId: "00000000-0000-4000-8000-000000000001",
    mf24SpaceId: "personal:test",
    apiKey: "configured",
    resolver: globalEmpty,
    rpcCaller,
    nativeInterpreter: () => ({
      intent: "unknown",
      resolution_layer: "economy_ai",
      confidence: 0.1,
      requires_confirmation: true,
      transactions: [],
      reply: "Preciso analisar.",
    }),
    privateContextLoader: async (args) => {
      loaderArgs = args;
      return {
        memory_facts: [],
        conversation_state: null,
        financial_snapshot: snapshot,
      };
    },
    aiCaller: async ({ layer, privateContext }) => {
      aiPrivateContext = privateContext;
      return {
        layer,
        model: "gpt-5.6-luna",
        usage: {},
        estimated_cost_usd: 0,
        latency_ms: 2,
        result: {
          intent: "financial_analysis",
          confidence: 0.93,
          requires_confirmation: true,
          needs_advanced: false,
          transactions: [],
          reply: "Análise baseada nos seus dados.",
        },
      };
    },
  });

  assert.equal(loaderArgs.today, "2026-09-07");
  assert.equal(loaderArgs.spaceId, "personal:test");
  assert.equal(aiPrivateContext.financial_snapshot.month.expense_minor, 245000);
  assert.equal(output.private_memory.financial_snapshot, true);
  assert.equal(output.private_memory.recent_transactions, 1);
  assert.equal(output.global_knowledge?.financial_snapshot, undefined);
});
