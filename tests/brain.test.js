import test from 'node:test';import assert from 'node:assert/strict';import {interpret} from '../lib/brain.js';const today='2026-09-04';
test('gasolina Ipiranga',()=>{const r=interpret('Gastei 100 de gasolina no Ipiranga hoje',{today});assert.equal(r.transactions[0].category,'combustivel');assert.equal(r.transactions[0].merchant,'Postos Ipiranga');assert.equal(r.transactions[0].date,today)});
test('duas datas',()=>{const r=interpret('Ontem gastei 180 no mercado e hoje coloquei 100 de gasolina',{today});assert.equal(r.transactions.length,2);assert.deepEqual(r.transactions.map(x=>x.date),['2026-09-03','2026-09-04'])});
test('parcelamento',()=>{const r=interpret('Comprei um celular de 1800 em 6 vezes no Nubank',{today});assert.equal(r.transactions[0].installments,6);assert.equal(r.transactions[0].account,'nubank')});
test('transferencia interna',()=>{const r=interpret('Transferi 500 do Nubank para o Inter',{today});assert.equal(r.intent,'internal_transfer');assert.equal(r.transactions[0].type,'transfer')});
test('fatura sem duplicar',()=>{const r=interpret('Paguei a fatura do cartão',{today});assert.equal(r.intent,'pay_card_bill')});
test('desconhecido escala',()=>{const r=interpret('Gastei 70 na Loja XPTQ',{today});assert.equal(r.resolution_layer,'economy_ai')});
