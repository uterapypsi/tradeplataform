import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHeadline,summarizeNews,riskGate,decisionExplain} from '../public/intelligence.js';
const NOW=new Date('2026-11-03T15:00:00.000Z');
function item(title,published='2026-11-03T13:00:00.000Z'){return {title,published,source:'Test Agency',url:'https://example.org/a'};}
test('classifica notícia e aponta ativos expostos sem recomendar transações',()=>{
 const x=analyzeHeadline(item('Fed cuts interest rates by 25 basis points'),NOW);
 assert.ok(x.topics.includes('rates'));
 assert.equal(x.highImpact,true);
 assert.ok(x.affected.includes('TLT'));
 assert.equal(x.factors.find(f=>f.id==='rates').direction,-1);
 assert.ok(x.classification.includes('não'));
});
test('afirmações contraditórias não geram orientação de preço',()=>{
 const x=analyzeHeadline(item('Oil rises, then falls as traders weigh forecasts'),NOW);
 assert.equal(x.factors.find(f=>f.id==='oil').direction,0);
});
test('propostas só surgem com títulos recentes concordantes',()=>{
 const a=summarizeNews([item('Oil prices rise sharply'),item('Crude oil gains as demand climbs'),item('Old oil drops','2026-10-01T10:00:00Z')],NOW);
 assert.equal(a.recentCount,2);
 assert.equal(a.proposals.find(p=>p.id==='oil')?.direction,1);
});
test('risco de eventos bloqueia apenas ativos relacionados e tem janela de seis horas',()=>{
 const news=[item('Fed rate hike decision shakes bond markets')];
 assert.equal(riskGate('TLT',news,{available:true,now:NOW}).blocked,true);
 assert.equal(riskGate('TLT',news,{enabled:false,available:true,now:NOW}).blocked,false);
 assert.equal(riskGate('TLT',[item('Fed rate hike decision','2026-11-02T04:00:00Z')],{now:NOW}).blocked,false);
});
test('sem feed externo não abre automaticamente em modo externo',()=>{
 assert.equal(riskGate('GOLD',[],{available:false,mode:'live',now:NOW}).blocked,true);
 assert.equal(riskGate('GOLD',[],{available:false,mode:'demo',now:NOW}).blocked,false);
});
test('justificação auditável não altera o modelo de mercado',()=>{
 const obj=decisionExplain({symbol:'SPY',signal:'COMPRA',score:73,macro:10,gate:{blocked:true,reason:'Evento recente'},quote:{source:'Teste',timestamp:NOW.toISOString()}});
 assert.equal(obj.permitted,false);assert.equal(obj.marketSource,'Teste');assert.match(obj.explanation,/Evento recente/);
});
