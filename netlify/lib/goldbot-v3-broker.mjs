/** Official JSON cTrader Open API, DEMO endpoint only. No live endpoint exists here. */
import {V3,V3Error,requireV3,isDemoAccount,isTradeScope,money,sizeDemoBuy} from './goldbot-v3-policy.mjs';
export const CTRADER_DEMO='wss://demo.ctraderapi.com:5036';
export const PT=Object.freeze({APP_REQ:2100,APP_RES:2101,ACCOUNT_REQ:2102,ACCOUNT_RES:2103,
  NEW_ORDER:2106,ASSETS_REQ:2112,ASSETS_RES:2113,SYMBOL_LIST_REQ:2114,SYMBOL_LIST_RES:2115,
  SYMBOL_REQ:2116,SYMBOL_RES:2117,TRADER_REQ:2121,TRADER_RES:2122,RECONCILE_REQ:2124,
  RECONCILE_RES:2125,EXECUTION:2126,SPOT_REQ:2127,SPOT_RES:2128,SPOT:2131,
  ORDER_ERROR:2132,ERROR:2142,ACCOUNT_LIST_REQ:2149,ACCOUNT_LIST_RES:2150,HEARTBEAT:51});

export class DemoSocket {
  constructor({WebSocketClass=globalThis.WebSocket,timeout=15500}={}){
    requireV3(typeof WebSocketClass==='function','NO_WEBSOCKET','WebSocket indisponível no servidor.',503);
    this.WebSocketClass=WebSocketClass;this.timeout=timeout;this.seq=0;
    this.socket=null;this.waiters=new Map();this.spots=new Map();this.closed=false;
  }
  async open(){
    this.socket=new this.WebSocketClass(CTRADER_DEMO);
    const socket=this.socket;
    socket.addEventListener('message',event=>this.onMessage(event));
    socket.addEventListener('close',()=>this.failAll('CONNECTION_CLOSED'));
    socket.addEventListener('error',()=>this.failAll('CONNECTION_ERROR'));
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new V3Error('TIMEOUT','A cTrader Demo não respondeu.',503)),this.timeout);
      const ok=()=>{clearTimeout(timer);resolve()};
      const fail=()=>{clearTimeout(timer);reject(new V3Error('SOCKET','Não foi possível abrir a cTrader Demo.',503));};
      if(socket.readyState===this.WebSocketClass.OPEN){ok();return;}
      socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});
      socket.addEventListener('close',fail,{once:true});
    });
  }
  failAll(code){
    for(const waiter of this.waiters.values()){clearTimeout(waiter.timer);waiter.reject(new V3Error(code,'Ligação à cTrader interrompida.',503));}
    this.waiters.clear();
    for(const spot of this.spots.values()){clearTimeout(spot.timer);spot.reject(new V3Error(code,'Cotação da cTrader indisponível.',503));}
    this.spots.clear();
  }
  onMessage(event){
    let message;try{message=JSON.parse(String(event.data));}catch{return;}
    if(message.payloadType===PT.SPOT){
      const id=String(message.payload?.symbolId??'');const spot=this.spots.get(id);
      if(spot){this.spots.delete(id);clearTimeout(spot.timer);spot.resolve(message.payload||{});}
      return;
    }
    const id=String(message.clientMsgId||'');
    const pending=this.waiters.get(id);
    if(!pending)return;
    if([PT.ERROR,PT.ORDER_ERROR].includes(message.payloadType)){
      this.waiters.delete(id);clearTimeout(pending.timer);
      pending.reject(new V3Error('CTRADER_REJECTED','A cTrader rejeitou o pedido. Consulta os registos da corretora.',502));
      return;
    }
    if(message.payloadType===pending.expected){
      this.waiters.delete(id);clearTimeout(pending.timer);pending.resolve(message.payload||{});
      return;
    }
    // An order execution can have one of several valid exchange states.
  }
  call(type,expected,payload){
    requireV3(this.socket?.readyState===this.WebSocketClass.OPEN,'NOT_CONNECTED','Sem ligação à cTrader.',503);
    const id='gb3-'+(++this.seq);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiters.delete(id);reject(new V3Error('TIMEOUT','Confirma o estado na corretora antes de tentar outra operação.',504));},this.timeout);
      this.waiters.set(id,{expected,resolve,reject,timer});
      try{this.socket.send(JSON.stringify({clientMsgId:id,payloadType:type,payload}));}
      catch{clearTimeout(timer);this.waiters.delete(id);reject(new V3Error('SEND_FAILED','Falha de comunicação com cTrader.',503));}
    });
  }
  async spot(accountId,symbolId){
    const key=String(symbolId);
    const spotPromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.spots.delete(key);reject(new V3Error('NO_QUOTE','Cotação atual indisponível.',503));},7000);
      this.spots.set(key,{resolve,reject,timer});
    });
    await this.call(PT.SPOT_REQ,PT.SPOT_RES,{ctidTraderAccountId:accountId,symbolId:[symbolId],subscribeToSpotTimestamp:true});
    const row=await spotPromise;
    const bid=Number(row.bid)/100000,ask=Number(row.ask)/100000;
    const ts=Number(row.timestamp);
    const ms=ts>1e12?ts:ts*1000;
    requireV3(Number.isFinite(ms)&&Math.abs(Date.now()-ms)<=V3.maxAgeQuoteMs,'STALE_QUOTE','Cotação antiga; sem operação.');
    requireV3(Number.isFinite(bid)&&Number.isFinite(ask)&&ask>bid,'BAD_QUOTE','Cotação inválida.');
    return {bid,ask,receivedAt:new Date(ms).toISOString()};
  }
  close(){try{this.failAll('CLOSED');this.socket?.close();}catch{}}
}

export async function withDemoBroker({clientId,clientSecret,accessToken,login,accountId,tradeRequired=false},cb,{makeSocket=()=>new DemoSocket()}={}){
  const socket=makeSocket();
  try{
    await socket.open();
    await socket.call(PT.APP_REQ,PT.APP_RES,{clientId,clientSecret});
    const listed=await socket.call(PT.ACCOUNT_LIST_REQ,PT.ACCOUNT_LIST_RES,{accessToken});
    const scope=listed.permissionScope;
    if(tradeRequired){
      requireV3(isTradeScope(scope),'VIEW_ONLY','Conta sem autorização para negociação demo.');
      requireV3(!(listed.ctidTraderAccount||[]).some(a=>a.isLive===true||a.isLive==='true'),
        'LIVE_AUTHORIZED','O token também autoriza conta real. Revoga e autoriza SOMENTE a conta demo.',403);
    }
    const matches=(Array.isArray(listed.ctidTraderAccount)?listed.ctidTraderAccount:[]).filter(a=>
      isDemoAccount(a) && String(a.traderLogin)===String(login) &&
      (accountId==null || String(a.ctidTraderAccountId)===String(accountId)));
    requireV3(matches.length===1,'ACCOUNT_MISMATCH','Conta DEMO autorizada não corresponde ao utilizador.',403);
    const account=matches[0];
    const id=account.ctidTraderAccountId;
    await socket.call(PT.ACCOUNT_REQ,PT.ACCOUNT_RES,{ctidTraderAccountId:id,accessToken});
    const ctx={socket,scope,account,accountId:id};
    return await cb(ctx);
  }finally{socket.close()}
}

export async function getBrokerSnapshot(ctx){
  const a=ctx.accountId,s=ctx.socket;
  const [traderReply,assetReply]=await Promise.all([
    s.call(PT.TRADER_REQ,PT.TRADER_RES,{ctidTraderAccountId:a}),
    s.call(PT.ASSETS_REQ,PT.ASSETS_RES,{ctidTraderAccountId:a})
  ]);
  const t=traderReply.trader||{};
  requireV3(String(t.traderLogin||ctx.account.traderLogin)===String(ctx.account.traderLogin),'LOGIN_MISMATCH','A corretora devolveu outra conta.');
  const asset=(assetReply.asset||[]).find(x=>String(x.assetId)===String(t.depositAssetId));
  const currency=String(asset?.name||'').toUpperCase();
  const balance=money(t.balance,t.moneyDigits);
  requireV3(Number.isFinite(balance)&&balance>=0,'BALANCE','Saldo da corretora inválido.');
  return {login:String(ctx.account.traderLogin),accountId:String(a),currency,balance,
    isLive:false,isLimitedRisk:t.isLimitedRisk===true,scope:ctx.scope,
    accessRights:t.accessRights,checkedAt:new Date().toISOString()};
}
export async function prepareBuy(ctx,{close,eurUsd,balance,currency,limitedRisk=false}){
  const s=ctx.socket,id=ctx.accountId;
  const [symbols,positions]=await Promise.all([
    s.call(PT.SYMBOL_LIST_REQ,PT.SYMBOL_LIST_RES,{ctidTraderAccountId:id}),
    s.call(PT.RECONCILE_REQ,PT.RECONCILE_RES,{ctidTraderAccountId:id})
  ]);
  // Fail closed for ANY pre-existing broker position or pending order.
  requireV3((positions.position||[]).length===0 && (positions.order||[]).length===0,
    'EXPOSURE','Já existem posições ou ordens na conta demo; o GoldBot não irá abrir outras.');
  const matched=(symbols.symbol||[]).filter(v=>
    String(v.symbolName||'').toUpperCase().replace('/','')==='XAUUSD'&&v.enabled!==false);
  requireV3(matched.length===1,'SYMBOL','XAUUSD indisponível ou ambíguo na corretora.');
  const brief=matched[0];
  const detail=await s.call(PT.SYMBOL_REQ,PT.SYMBOL_RES,{ctidTraderAccountId:id,symbolId:[brief.symbolId]});
  const full=(detail.symbol||[]).find(x=>String(x.symbolId)===String(brief.symbolId));
  requireV3(full,'SYMBOL_PROFILE','Metadados do instrumento indisponíveis.');
  const quote=await s.spot(id,brief.symbolId);
  const plan=sizeDemoBuy({balance,currency,eurUsd,ask:quote.ask,bid:quote.bid,close,
    volMin:Number(full.minVolume),volMax:Number(full.maxVolume),volStep:Number(full.stepVolume),
    limitedRisk,tradable:full.tradingMode===0||full.tradingMode==null});
  return {quote,plan,symbolId:brief.symbolId,brokerSymbol:brief.symbolName};
}
export async function submitDemoBuy(ctx,{symbolId,plan,uid,date}){
  requireV3(!ctx.account.isLive,'LIVE_BLOCK','Contas reais estão bloqueadas.',403);
  requireV3(isTradeScope(ctx.scope),'VIEW_ONLY','Falta autorizar negociação na cTrader.',403);
  const clientOrderId=`GB3-${uid}-${date.replaceAll('-','')}`;
  const payload={ctidTraderAccountId:ctx.accountId,symbolId,orderType:1,tradeSide:1,
    volume:plan.volume,relativeStopLoss:plan.relativeStopLoss,
    relativeTakeProfit:plan.relativeTakeProfit,clientOrderId,label:'GOLDBOT-DEMO-V3',comment:'Conta demonstracao, estrategia diaria automatica'};
  // Execution response is evidence of accepted/rejected event; no blind retries.
  const event=await ctx.socket.call(PT.NEW_ORDER,PT.EXECUTION,payload);
  const kind=Number(event.executionType);
  requireV3([2,3,4,11].includes(kind),'ORDER_NOT_CONFIRMED','Ordem sem confirmação positiva; verifica no cTrader antes de agir.',502);
  return {clientOrderId,executionType:kind,orderId:event.order?.orderId?String(event.order.orderId):null,
    at:new Date().toISOString(),volume:plan.volume,side:'BUY',symbol:'XAUUSD',environment:'DEMO'};
}
