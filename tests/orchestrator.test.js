import test from 'node:test';
import assert from 'node:assert/strict';
import {orchestrate} from '../lib/orchestrator.js';

const globalEmpty = async () => ({suggested_layer:'economy_ai', confidence:0, entities:{candidates:[]}, rules:{matches:[]}});
const rpcCaller = async () => null;

test('known native transaction does not spend OpenAI', async () => {
  let calls = 0;
  const result = await orchestrate('Gastei 100 de gasolina no Ipiranga hoje', {
    today:'2026-09-05', apiKey:'configured', resolver:globalEmpty, rpcCaller,
    aiCaller:async () => { calls++; throw new Error('should_not_call'); },
  });
  assert.equal(calls, 0);
  assert.equal(result.resolution_layer, 'deterministic');
  assert.equal(result.transactions[0].category, 'combustivel');
  assert.equal(result.openai.used, false);
});

test('unknown merchant escalates to economy OpenAI', async () => {
  const layers = [];
  const result = await orchestrate('Gastei 70 na Loja XPTQ', {
    today:'2026-09-05', apiKey:'configured', resolver:globalEmpty, rpcCaller,
    aiCaller:async ({layer}) => {
      layers.push(layer);
      return {layer, model:'gpt-5.6-luna', usage:{input_tokens:10,output_tokens:10}, estimated_cost_usd:.000014,
        latency_ms:10, result:{intent:'create_transactions',confidence:.82,requires_confirmation:true,needs_advanced:false,
          transactions:[{type:'expense',amount:70,currency:'BRL',category:'a_confirmar',merchant:'Loja XPTQ',account:null,from_account:null,to_account:null,date:'2026-09-05',installments:null,description:null}],reply:'Confira e confirme.'}};
    },
  });
  assert.deepEqual(layers, ['economy_ai']);
  assert.equal(result.resolution_layer, 'economy_ai');
  assert.equal(result.openai.model, 'gpt-5.6-luna');
  assert.equal(result.requires_confirmation, true);
});

test('serious ambiguity escalates economy to advanced', async () => {
  const layers = [];
  const result = await orchestrate('Analise esta movimentação ambígua e diga o tratamento correto', {
    today:'2026-09-05', apiKey:'configured', resolver:globalEmpty, rpcCaller,
    nativeInterpreter:() => ({intent:'unknown',resolution_layer:'economy_ai',confidence:.2,requires_confirmation:true,transactions:[],reply:'Preciso de IA.'}),
    aiCaller:async ({layer}) => {
      layers.push(layer);
      if (layer === 'economy_ai') return {layer,model:'gpt-5.6-luna',usage:{},estimated_cost_usd:0,latency_ms:3,
        result:{intent:'unknown',confidence:.4,requires_confirmation:true,needs_advanced:true,transactions:[],reply:'Ambíguo.'}};
      return {layer,model:'gpt-5.6-terra',usage:{},estimated_cost_usd:0,latency_ms:5,
        result:{intent:'financial_analysis',confidence:.91,requires_confirmation:true,needs_advanced:false,transactions:[],reply:'Análise concluída sem executar nada.'}};
    },
  });
  assert.deepEqual(layers, ['economy_ai','advanced_ai']);
  assert.equal(result.resolution_layer, 'advanced_ai');
  assert.equal(result.openai.model, 'gpt-5.6-terra');
});

test('missing OpenAI secret preserves safe fallback', async () => {
  const result = await orchestrate('Gastei 70 na Loja XPTQ', {
    today:'2026-09-05', apiKey:'', resolver:globalEmpty, rpcCaller,
  });
  assert.equal(result.openai.status, 'not_configured');
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.transactions[0].category, 'a_confirmar');
});
