/* MacroPilot — motor determinístico e auditável. Nunca transmite ordens a corretoras. */
export const FACTORS = [
  {id:'inflation',name:'Inflação',short:'IPC',description:'Surpresas de inflação podem alterar juros esperados e margens.'},
  {id:'rates',name:'Juros',short:'Taxas',description:'Juros mais altos tendem a pesar em ativos de longa duração.'},
  {id:'dollar',name:'Dólar americano',short:'USD',description:'Dólar forte pode pressionar commodities cotadas em USD.'},
  {id:'growth',name:'Crescimento',short:'PIB',description:'Crescimento económico pode apoiar lucros empresariais.'},
  {id:'jobs',name:'Mercado de trabalho',short:'Emprego',description:'Emprego forte pode apoiar procura, mas também juros.'},
  {id:'geopolitics',name:'Risco geopolítico',short:'Risco',description:'Incerteza pode elevar procura de ativos defensivos.'},
  {id:'oil',name:'Choque de energia',short:'Energia',description:'Energia mais cara pode afetar inflação e custos.'}
];
export const ASSETS = {
  GOLD:{name:'Ouro spot',class:'Metal',unit:'USD/onça',base:4010,vol:.0038,weights:{inflation:.45,rates:-.95,dollar:-.9,growth:-.1,jobs:-.15,geopolitics:.88,oil:.2}},
  GLD:{name:'ETF de ouro GLD',class:'ETF',unit:'USD',base:350,vol:.004,weights:{inflation:.35,rates:-.82,dollar:-.83,growth:-.13,jobs:-.13,geopolitics:.82,oil:.18}},
  SPY:{name:'S&P 500 ETF',class:'ETF',unit:'USD',base:652,vol:.007,weights:{inflation:-.6,rates:-.74,dollar:-.18,growth:.91,jobs:.3,geopolitics:-.84,oil:-.38}},
  QQQ:{name:'Nasdaq 100 ETF',class:'ETF',unit:'USD',base:590,vol:.010,weights:{inflation:-.69,rates:-.96,dollar:-.16,growth:.94,jobs:.24,geopolitics:-.9,oil:-.3}},
  NVDA:{name:'NVIDIA',class:'Ação',unit:'USD',base:192,vol:.021,weights:{inflation:-.6,rates:-.81,dollar:-.22,growth:.96,jobs:.23,geopolitics:-.83,oil:-.26}},
  AAPL:{name:'Apple',class:'Ação',unit:'USD',base:275,vol:.011,weights:{inflation:-.46,rates:-.65,dollar:-.4,growth:.89,jobs:.26,geopolitics:-.7,oil:-.19}},
  TLT:{name:'ETF obrigações EUA',class:'ETF',unit:'USD',base:92,vol:.006,weights:{inflation:-.86,rates:-1,dollar:-.05,growth:-.2,jobs:-.16,geopolitics:.51,oil:-.22}},
  OIL:{name:'Futuro petróleo WTI',class:'Futuro',unit:'USD/barril',base:78,vol:.015,weights:{inflation:.19,rates:-.17,dollar:-.49,growth:.86,jobs:.25,geopolitics:.55,oil:1}},
  BTC:{name:'Bitcoin',class:'Cripto',unit:'USD',base:72000,vol:.023,weights:{inflation:-.2,rates:-.79,dollar:-.62,growth:.58,jobs:.06,geopolitics:-.55,oil:-.14}},
  EURUSD:{name:'EUR/USD',class:'Câmbio',unit:'USD/EUR',base:1.15,vol:.003,weights:{inflation:-.1,rates:-.51,dollar:-1,growth:.31,jobs:-.15,geopolitics:-.16,oil:.06}}
};
export const WATCH=['GOLD','SPY','QQQ','NVDA','AAPL','TLT','OIL','EURUSD'];
export const RELATIONS=[
  ['inflation','rates','normalmente +'],['jobs','rates','pode +'],['oil','inflation','pode +'],
  ['growth','jobs','tende +'],['rates','dollar','pode +'],['dollar','GOLD','tende −'],
  ['rates','QQQ','tende −'],['geopolitics','GOLD','pode +'],['growth','SPY','tende +'],
  ['oil','SPY','pode −']
];
export const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function macroScore(symbol,shocks={}){
  const w=ASSETS[symbol]?.weights||{};
  let acc=0,den=0;
  for(const [factor,weight] of Object.entries(w)) {
    const shock=clamp(Number(shocks[factor]||0),-2,2);
    acc+=shock*weight;den+=Math.abs(weight)*2;
  }
  return den ? Math.round(clamp(acc/den*100,-100,100)) : 0;
}
export function indicators(series){
  const points=(series||[]).map(x=>typeof x==='number'?x:Number(x.c??x.price)).filter(x=>Number.isFinite(x)&&x>0);
  if(points.length<20)return {valid:false,reason:'Histórico inferior a 20 pontos',n:points.length};
  const avg=(arr)=>arr.reduce((sum,v)=>sum+v,0)/arr.length;
  const fast=avg(points.slice(-5));const slow=avg(points.slice(-20));
  let gains=0,losses=0;
  for(let i=points.length-14;i<points.length;i++){
    const delta=points[i]-points[i-1];gains+=Math.max(delta,0);losses+=Math.max(-delta,0);
  }
  const rsi=losses===0?(gains===0?50:100):100-100/(1+gains/losses);
  return {valid:true,n:points.length,sma5:fast,sma20:slow,rsi,price:points.at(-1),momentum:(fast/slow-1)*100};
}
export function evaluate(symbol,series,shocks){
  const i=indicators(series),macro=macroScore(symbol,shocks);
  if(!i.valid)return {signal:'AGUARDAR',confidence:0,reason:i.reason,indicator:i,macro};
  const bullish=i.sma5>i.sma20 && i.rsi<72 && i.rsi>40;
  const bearish=i.sma5<i.sma20 || i.rsi>78;
  let confidence=clamp(Math.round(54+Math.min(20,Math.abs(i.momentum)*8)+macro*.13+(i.rsi>50&&i.rsi<69?5:0)),0,90);
  if(macro < -35) confidence-=12;
  let signal='AGUARDAR',reason='Médias e força relativa sem alinhamento suficiente.';
  if(bullish&&macro>=-30){signal='COMPRA';reason='SMA5 acima da SMA20, RSI moderado e cenário macro não fortemente adverso.';}
  else if(bearish){signal='EVITAR';reason='Tendência técnica desfavorável ou RSI demasiado elevado.';}
  else if(macro < -30){reason='Cenário macro configurado é adverso a este ativo.';}
  return {signal,confidence,reason,indicator:i,macro};
}
export function positionSizing({cash,equity,riskPct,stopPct,price}){
  if(![cash,equity,riskPct,stopPct,price].every(v=>Number.isFinite(Number(v))))return {qty:0,notional:0};
  if(cash<=0||equity<=0||riskPct<=0||stopPct<=0||price<=0)return {qty:0,notional:0};
  const maxRisk=equity*clamp(riskPct,0.01,2)/100;
  const stopDistance=price*clamp(stopPct,.2,25)/100;
  const qtyByRisk=maxRisk/stopDistance;
  // no leverage; cap allocation at 25% of equity, also never spend more than cash
  const qty=Math.floor(Math.min(qtyByRisk,cash/price,equity*.25/price)*100000)/100000;
  return {qty,notional:qty*price,riskUSD:qty*stopDistance,maxRisk};
}
export function closePosition(pos,price,at=new Date().toISOString()){
  const revenue=pos.qty*price;
  const pnl=(price-pos.entry)*pos.qty;
  return {symbol:pos.symbol,side:'VENDA',qty:pos.qty,entry:pos.entry,exit:price,pnl,at,revenue,reason:'Saída virtual'};
}
export function validateSettings(s){return {
  riskPct:clamp(Number(s.riskPct)||.5,.1,2),
  stopPct:clamp(Number(s.stopPct)||2,.5,15),
  takePct:clamp(Number(s.takePct)||4,.5,30),
  dailyLossPct:clamp(Number(s.dailyLossPct)||2,.5,10),
  maxPositions:clamp(Math.floor(Number(s.maxPositions)||2),1,5),
  minConfidence:clamp(Math.floor(Number(s.minConfidence)||68),50,90)
};}
export function realizedToday(trades,now=new Date()){
  const start=new Date(now);start.setHours(0,0,0,0);
  return (trades||[]).filter(t=>t.side==='VENDA'&&new Date(t.at)>=start).reduce((sum,t)=>sum+Number(t.pnl||0),0);
}
