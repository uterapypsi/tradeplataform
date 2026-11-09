// Policy cases from the GoldBot 3.1 offline package, exercised against repository code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {V3,sizeDemoBuy,evaluateSignal,canArm} from '../netlify/lib/goldbot-v3-policy.mjs';
import {PT,demoOrderIntent,submitDemoBuy,reconcileDemoOrder} from '../netlify/lib/goldbot-v3-broker.mjs';

const history=Array.from({length:22},(_,i)=>({t:new Date(Date.UTC(2026,9,1+i)).toISOString(),c:4000+i}));
const valid={balance:1000,currency:'EUR',eurUsd:1.15,ask:4000,bid:3999,close:3990,volMin:1,volMax:1000,volStep:1};
const errors=(fn,code)=>assert.throws(fn,e=>e?.code===code);
const plan=sizeDemoBuy(valid);
test('01 | WAIT quando notícias bloqueiam a entrada',()=>{
  const x=evaluateSignal({bars:history,tech:{signal:'COMPRA',confidence:90},newsAllowed:false,newsReason:'Impacto noticioso'});
  assert.equal(x.action,'WAIT'); assert.equal(x.reason,'Impacto noticioso');
});
test('02 | WAIT quando pontuação é 64 (<68)',()=>{
  const x=evaluateSignal({bars:history,tech:{signal:'COMPRA',confidence:64},newsAllowed:true});assert.equal(x.action,'WAIT');
});
test('03 | BUY com 75 pontos e notícias liberadas',()=>{
  const x=evaluateSignal({bars:history,tech:{signal:'COMPRA',confidence:75},newsAllowed:true});assert.equal(x.action,'BUY');
});
test('04 | Limiar mínimo é 68',()=>assert.equal(V3.minConfidence,68));
test('05 | Dimensionamento inclui stop e take-profit positivos',()=>{
  assert.ok(plan.volume>0); assert.ok(plan.relativeStopLoss>0);assert.ok(plan.relativeTakeProfit>plan.relativeStopLoss);
  assert.equal(plan.riskPercent,0.5);
});
test('06 | Risco estimado não ultrapassa 0,5% do saldo',()=>{
  assert.ok(plan.approxRiskAccountCurrency<=5);assert.ok(plan.volume%valid.volStep===0);
});
test('07 | Spread elevado é bloqueado',()=>errors(()=>sizeDemoBuy({...valid,bid:3990}),'SPREAD'));
test('08 | Preço afastado do fecho é bloqueado',()=>errors(()=>sizeDemoBuy({...valid,close:3400}),'DEVIATION'));
test('09 | Volume mínimo incompatível é bloqueado',()=>errors(()=>sizeDemoBuy({...valid,volMin:100,volStep:100}),'MIN_VOLUME'));
test('10 | Conta de risco limitado é bloqueada',()=>errors(()=>sizeDemoBuy({...valid,limitedRisk:true}),'LIMITED_RISK'));
test('11 | Instrumento fechado é bloqueado',()=>errors(()=>sizeDemoBuy({...valid,tradable:false}),'SYMBOL_CLOSED'));
test('12 | Administrador desligado bloqueia armar agente',()=>errors(()=>canArm({user:{active:true,account:{isLive:false}},globalEnabled:false,connected:true,scope:1}),'MASTER_OFF'));
test('13 | Conta real bloqueia agente',()=>errors(()=>canArm({user:{active:true,account:{isLive:true}},globalEnabled:true,connected:true,scope:1}),'LIVE_BLOCK'));
test('14 | Scope apenas leitura bloqueia agente',()=>errors(()=>canArm({user:{active:true,account:{isLive:false}},globalEnabled:true,connected:true,scope:0}),'VIEW_ONLY'));
const account = {isLive:false,ctidTraderAccountId:123};
const context = call => ({account,accountId:123,scope:1,socket:{call}});
const request = ctx => demoOrderIntent(ctx,{
  symbolId:42,plan:{...plan,digits:2},uid:'abcdef123456',date:'2026-11-09'
});

for(const [kind,status] of [[2,'ACCEPTED'],[3,'FILLED'],[4,'REPLACED'],[5,'CANCELLED'],
  [6,'EXPIRED'],[7,'REJECTED'],[11,'PARTIALLY_FILLED']]){
  test(`Evento ${kind} preserva ${status} até à reconciliação`,async()=>{
    let calls=0;
    const ctx=context(async(type,expected,payload)=>{
      calls++;
      assert.equal(type,PT.NEW_ORDER);
      assert.equal(expected,PT.EXECUTION);
      assert.equal(payload.volume,plan.volume);
      assert.equal(payload.relativeStopLoss,plan.relativeStopLoss);
      assert.equal(payload.relativeTakeProfit,plan.relativeTakeProfit);
      assert.equal(payload.tradeSide,1);
      return {ctidTraderAccountId:123,executionType:kind,order:{orderId:'42'}};
    });
    const receipt=await submitDemoBuy(ctx,request(ctx));
    assert.equal(receipt.status,status);
    assert.equal(receipt.resolved,false);
    assert.equal(calls,1);
  });
}

test('Bloqueia envio em conta real ou com permissão de leitura',async()=>{
  const ctx=context(()=>assert.fail('Pedido inesperado'));
  await assert.rejects(submitDemoBuy({...ctx,account:{...account,isLive:true}},request(ctx)),{code:'LIVE_BLOCK'});
  await assert.rejects(submitDemoBuy({...ctx,scope:0},request(ctx)),{code:'VIEW_ONLY'});
});

function brokerFixture({orderStatus=2,executedVolume=plan.volume,stop=true,found=true,
  accountId=123,wrongOrder=false}={}){
  const types=[];
  const ctx=context(async(type)=>{
    types.push(type);
    const tradeData={symbolId:42,tradeSide:1,volume:plan.volume};
    const order={orderId:'42',clientOrderId:intent.clientOrderId,orderStatus,executedVolume,
      tradeData:{...tradeData,symbolId:wrongOrder?43:42},positionId:'10'};
    const position={positionId:'10',price:4000,
      stopLoss:stop?4000-plan.relativeStopLoss/100000:undefined,
      takeProfit:4000+plan.relativeTakeProfit/100000,
      tradeData:{...tradeData,volume:executedVolume}};
    const reply={ctidTraderAccountId:accountId};
    if(type===PT.RECONCILE_REQ)return {...reply,position:[position]};
    if(type===PT.ORDER_LIST_REQ)return {...reply,order:found?[order]:[],hasMore:!found};
    if(type===PT.ORDER_DETAILS_REQ)return {...reply,order};
    assert.fail('A reconciliação só pode ler dados da corretora');
  });
  const intent=request(ctx);
  return {ctx,intent,types};
}

test('Timeout sem ID recupera ordem pelo identificador do cliente e verifica proteção',async()=>{
  const {ctx,intent,types}=brokerFixture();
  const result=await reconcileDemoOrder(ctx,{...intent,status:'UNKNOWN'});
  assert.equal(result.status,'FILLED');
  assert.equal(result.executedVolume,plan.volume);
  assert.equal(result.protectionVerified,true);
  assert.equal(result.resolved,true);
  assert.deepEqual(types,[PT.RECONCILE_REQ,PT.ORDER_LIST_REQ,PT.ORDER_DETAILS_REQ,PT.RECONCILE_REQ]);
});

test('Ordem conhecida usa ID e preserva execução parcial como pendente',async()=>{
  const {ctx,intent,types}=brokerFixture({orderStatus:1,executedVolume:1});
  const result=await reconcileDemoOrder(ctx,{...intent,orderId:'42'});
  assert.equal(result.status,'PARTIALLY_FILLED');
  assert.equal(result.resolved,false);
  assert.deepEqual(types,[PT.ORDER_DETAILS_REQ,PT.RECONCILE_REQ]);
});

test('Cancelamento parcial preserva volume e mantém bloqueio se falta proteção',async()=>{
  const {ctx,intent}=brokerFixture({orderStatus:5,executedVolume:1,stop:false});
  const result=await reconcileDemoOrder(ctx,intent);
  assert.equal(result.status,'CANCELLED');
  assert.equal(result.executedVolume,1);
  assert.equal(result.resolved,false);
});

test('Falta de stop impede confirmação de reconciliação',async()=>{
  const {ctx,intent}=brokerFixture({stop:false});
  const result=await reconcileDemoOrder(ctx,intent);
  assert.equal(result.status,'FILLED');
  assert.equal(result.protectionVerified,false);
  assert.equal(result.resolved,false);
});

test('Sem correspondência no histórico, mantém intenção incerta',async()=>{
  const {ctx,intent}=brokerFixture({found:false});
  const pending={...intent,status:'UNKNOWN'};
  assert.deepEqual(await reconcileDemoOrder(ctx,pending),pending);
});

test('Rejeição confirmada e volume zero encerram a intenção',async()=>{
  const {ctx,intent}=brokerFixture({orderStatus:3,executedVolume:0});
  const result=await reconcileDemoOrder(ctx,intent);
  assert.equal(result.status,'REJECTED');
  assert.equal(result.resolved,true);
});

test('Recusa respostas de outra conta ou instrumento',async()=>{
  const foreign=brokerFixture({accountId:999});
  await assert.rejects(reconcileDemoOrder(foreign.ctx,foreign.intent),{code:'ACCOUNT_MISMATCH'});
  const wrong=brokerFixture({wrongOrder:true});
  await assert.rejects(reconcileDemoOrder(wrong.ctx,wrong.intent),{code:'ORDER_MISMATCH'});
});

test('Runner reserva a conta antes do envio e bloqueia novo ciclo após timeout',async t=>{
  const {runTenantDaily,reconcileTenantDemo}=await import('../netlify/lib/goldbot-v3-runner.mjs');
  const {protect}=await import('../netlify/lib/goldbot-v3-store.mjs');
  const env={CTRADER_CLIENT_ID:'mock-client',CTRADER_CLIENT_SECRET:'mock-secret',
    GOLDBOT_V3_DATA_KEY:'mock-key-for-offline-testing-only',GOLDBOT_V3_ALLOW_DEMO_ORDERS:'true'};
  for(const [name,value] of Object.entries(env)){
    const previous=process.env[name];
    process.env[name]=value;
    t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
  }
  const uid='abcdef123456';
  const tenant={id:uid,active:true,armed:true,initialBalance:1000,
    account:{accountId:'123',login:'12345',scope:1,currency:'EUR',isLive:false}};
  const accountKey='demo-order/123';
  const rows=new Map();
  let revision=0, sends=0;
  const s={
    get:async key=>rows.get(key)?.data,
    getWithMetadata:async key=>rows.get(key),
    setJSON:async(key,data,{onlyIfNew,onlyIfMatch}={})=>{
      const previous=rows.get(key);
      if((onlyIfNew&&previous)||(onlyIfMatch&&onlyIfMatch!==previous?.etag))return {modified:false};
      rows.set(key,{data,etag:String(++revision)});
      return {modified:true};
    }
  };
  await s.setJSON('master',{enabled:true});
  await s.setJSON(`tenant/${uid}`,tenant);
  await s.setJSON(`token/${uid}`,protect({
    accessToken:'mock-access-token-1234',refreshToken:'mock-refresh-token-1234',
    expiresAt:Date.now()+9*86400000
  },uid));
  const ctx=context(async type=>{
    if(type===PT.TRADER_REQ)return {trader:{traderLogin:'12345',balance:100000,moneyDigits:2,depositAssetId:1}};
    if(type===PT.ASSETS_REQ)return {asset:[{assetId:1,name:'EUR'}]};
    if(type===PT.SYMBOL_LIST_REQ)return {symbol:[{symbolId:42,symbolName:'XAUUSD'}]};
    if(type===PT.SYMBOL_REQ)return {symbol:[{symbolId:42,digits:2,minVolume:1,maxVolume:1000,stepVolume:1}]};
    if(type===PT.RECONCILE_REQ)return {ctidTraderAccountId:123};
    if(type===PT.ORDER_LIST_REQ)return {ctidTraderAccountId:123,order:[]};
    if(type===PT.NEW_ORDER){
      const reservation=await s.get(accountKey);
      if(reservation?.status!=='SUBMITTING')return {};
      sends++;
      throw new Error('simulated timeout');
    }
    throw new Error('unexpected broker request');
  });
  ctx.account={...ctx.account,traderLogin:'12345'};
  ctx.socket.spot=async()=>({ask:4000,bid:3999});
  const broker=async(_credentials,callback)=>callback(ctx);
  const signal={action:'BUY',date:'2026-11-09',close:3990};
  const result=await runTenantDaily(uid,{signal,fx:1.15,s,broker});
  assert.equal(result.action,'UNKNOWN');
  assert.equal(result.reconciliationRequired,true);
  assert.equal(sends,1);
  assert.equal((await s.get(`tenant/${uid}`)).armed,false);
  assert.equal((await reconcileTenantDemo(tenant,{s,broker})).status,'UNKNOWN');
  await s.setJSON(`tenant/${uid}`,tenant);
  const next=await runTenantDaily(uid,{signal:{...signal,date:'2026-11-10'},fx:1.15,s,broker});
  assert.equal(next.action,'RECONCILIATION_REQUIRED');
  assert.equal(sends,1);
});
