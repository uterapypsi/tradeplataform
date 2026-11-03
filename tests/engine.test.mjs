import {test} from 'node:test';
import assert from 'node:assert/strict';
import {macroScore,indicators,evaluate,positionSizing,closePosition,validateSettings,realizedToday} from '../public/engine.js';
test('macroScore 0 com choques neutros e sinal invertido para alta de juros',()=>{
  assert.equal(macroScore('GOLD',{}),0);
  assert.ok(macroScore('GOLD',{rates:2})<0);
  assert.ok(macroScore('TLT',{rates:2})<0);
});
test('indicadores exigem 20 preços e calculam RSI',()=>{
  assert.equal(indicators([1,2,3]).valid,false);
  const x=indicators(Array.from({length:30},(_,i)=>100+i));
  assert.equal(x.valid,true);assert.equal(x.rsi,100);
  assert.ok(x.sma5>x.sma20);
});
test('avaliação não inventa sinal sem histórico',()=>{
  assert.equal(evaluate('GOLD',[100,101],{}).signal,'AGUARDAR');
});
test('tamanho de posição aplica risco e evita alavancagem',()=>{
  const p=positionSizing({cash:10000,equity:10000,riskPct:1,stopPct:2,price:100});
  assert.ok(p.notional<=2500.0001);assert.ok(p.riskUSD<=100.0001);
  assert.equal(positionSizing({cash:0,equity:10000,riskPct:1,stopPct:2,price:100}).qty,0);
});
test('fecho virtual calcula P&L líquido de compra e venda sem comissões',()=>{
  const c=closePosition({symbol:'SPY',entry:100,qty:2},110,'2026-11-03T08:00:00Z');
  assert.equal(c.pnl,20);assert.equal(c.revenue,220);
});
test('validação limita parâmetros arriscados',()=>{
  const s=validateSettings({riskPct:200,stopPct:-1,maxPositions:99,minConfidence:20});
  assert.equal(s.riskPct,2);assert.equal(s.maxPositions,5);assert.equal(s.minConfidence,50);
});
test('resultado diário só soma operações fechadas hoje',()=>{
  const n=new Date('2026-11-03T12:00:00Z');
  const records=[{side:'VENDA',pnl:-40,at:'2026-11-03T09:00:00Z'},{side:'VENDA',pnl:25,at:'2026-11-02T09:00:00Z'},{side:'COMPRA',pnl:999,at:'2026-11-03T10:00:00Z'}];
  assert.equal(realizedToday(records,n),-40);
});
