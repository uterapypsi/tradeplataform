import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,normalizeBars,advancePaperState} from '../netlify/lib/goldbot-core.mjs';

const at='2026-11-03T13:00:00.000Z';
const series=Array.from({length:35},(_,i)=>({t:new Date(Date.UTC(2026,8,30+i)).toISOString(),c:100+i*1.8}));
const news=[{title:'Gold market update',source:'Demo teste',published:at,url:'https://example.org/test'}];

test('estado inicial isolado e sem operações reais',()=>{
 const s=initialState();assert.equal(s.cash,10000);assert.deepEqual(s.trades,[]);assert.deepEqual(s.positions,[]);
});
test('recusa histórico inferior a 20 pontos',()=>{
 const s=advancePaperState(initialState(),{series:series.slice(-4),news,now:at});
 assert.equal(s.lastDecision.action,'SEM_DADOS');assert.equal(s.trades.length,0);
});
test('ignora velas com preços inválidos',()=>{
 assert.deepEqual(normalizeBars([{t:'2026-11-03',c:-10},{t:'2026-11-02',c:'nan'}]),[]);
});
test('não compra sem notícias disponíveis',()=>{
 const s=advancePaperState(initialState(),{series,news:[],newsAvailable:false,now:at});
 assert.equal(s.trades.length,0);
 assert.equal(s.lastDecision.action,'BLOQUEIO_NOTICIAS');
});
test('não executa a mesma vela duas vezes',()=>{
 const s=advancePaperState(initialState(),{series,news,now:at},{minConfidence:50});
 const again=advancePaperState(s,{series,news,now:'2026-11-03T14:00:00.000Z'},{minConfidence:50});
 assert.equal(again.trades.length,s.trades.length);
 assert.equal(again.lastDecision.action,'SEM_NOVA_VELA');
});
test('confirma custos e nunca compra além do saldo',()=>{
 const s=advancePaperState(initialState(),{series,news,now:at},{minConfidence:50});
 assert.ok(s.cash>=0 && s.cash<=10000);
 assert.ok(s.positions.length<=1);
 if(s.positions.length){assert.ok(s.positions[0].qty>0);assert.ok(s.positions[0].cost<=10000);}
});
test('stop virtual é verificado apenas com uma vela nova',()=>{
 const s=initialState();s.lastBar='2026-11-01';s.cash=8990;
 s.positions=[{id:'old',symbol:'GOLD',qty:10,entry:100,cost:1010,stop:98,target:104}];
 const priceSeries=series.map((bar,i)=>i===series.length-2?{...bar,c:90}:bar);
 const out=advancePaperState(s,{series:priceSeries,news,now:at});
 assert.equal(out.positions.length,0);assert.equal(out.trades[0].side,'VENDA');
 assert.equal(out.lastDecision.action,'VENDA_VIRTUAL');
 assert.ok(out.cash>8990);
});
test('recusa velas demasiado antigas',()=>{
 const old=series.map(x=>({...x,t:x.t.replace('2026','2020')}));
 const s=advancePaperState(initialState(),{series:old,news,now:at});
 assert.equal(s.lastDecision.action,'DADOS_ANTIGOS');
 assert.equal(s.trades.length,0);
});
