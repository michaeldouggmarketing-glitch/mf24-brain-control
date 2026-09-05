import test from 'node:test';
import assert from 'node:assert/strict';
import {callOpenAILayer, estimateTextCost} from '../lib/openai.js';

test('OpenAI request uses Responses structured output and store false', async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    sent = JSON.parse(options.body);
    return {
      ok:true,
      json:async () => ({
        id:'resp_test', model:'gpt-5.6-luna',
        output:[{content:[{type:'output_text', text:JSON.stringify({
          intent:'create_transactions', confidence:.88, requires_confirmation:true,
          needs_advanced:false, transactions:[], reply:'Confirma?'
        })}]}],
        usage:{input_tokens:100, output_tokens:50, input_tokens_details:{cached_tokens:20}},
      }),
    };
  };
  const output = await callOpenAILayer({
    layer:'economy_ai', text:'gastei 70 na loja x', today:'2026-09-05',
    local:{intent:'create_transactions'}, global:null, apiKey:'secret-test', fetchImpl,
  });
  assert.equal(sent.store, false);
  assert.equal(sent.model, 'gpt-5.6-luna');
  assert.equal(sent.text.format.type, 'json_schema');
  assert.equal(sent.text.format.strict, true);
  assert.equal(output.result.requires_confirmation, true);
  assert.equal(output.stored, false);
  assert.equal(output.model, 'gpt-5.6-luna');
});

test('cost estimator accounts for cached input', () => {
  const value = estimateTextCost('gpt-5.6-luna', {
    input_tokens:1_000_000,
    output_tokens:1_000_000,
    input_tokens_details:{cached_tokens:500_000},
  });
  assert.equal(value, 1.31);
});
