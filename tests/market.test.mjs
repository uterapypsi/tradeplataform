import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTwelve} from '../netlify/functions/market.mjs';
test('Twelve Data converte dados históricos para ordem cronológica',()=>{
 const q=normalizeTwelve({values:[{datetime:'2026-11-02',close:'220.00'},{datetime:'2026-10-30',close:'200.00'}]},'AAPL');
 assert.equal(q.price,220);assert.equal(q.previous,200);assert.ok(Math.abs(q.changePct-10)<1e-10);assert.equal(q.series.length,2);
});
test('Twelve Data rejeita preço vazio e fornecedor com erro',()=>{
 assert.throws(()=>normalizeTwelve({status:'error',message:'Sem autorização'},'AAPL'),/Sem autorização/);
 assert.throws(()=>normalizeTwelve({values:[]},'GOLD'),/Histórico sem preços/);
});
