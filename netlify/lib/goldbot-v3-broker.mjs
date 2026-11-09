/** Official JSON cTrader Open API, DEMO endpoint only. No live endpoint exists here. */
import {V3,V3Error,requireV3,isDemoAccount,isTradeScope,money,sizeDemoBuy} from './goldbot-v3-policy.mjs';
export const CTRADER_DEMO='wss://demo.ctraderapi.com:5036';
export const PT=Object.freeze({APP_REQ:2100,APP_RES:2101,ACCOUNT_REQ:2102,ACCOUNT_RES:2103,
  NEW_ORDER:2106,ASSETS_REQ:2112,ASSETS_RES:2113,SYMBOL_LIST_REQ:2114,SYMBOL_LIST_RES:2115,
  SYMBOL_REQ:2116,SYMBOL_RES:2117,TRADER_REQ:2121,TRADER_RES:2122,RECONCILE_REQ:2124,
  RECONCILE_RES:2125,EXECUTION:2126,SPOT_REQ:2127,SPOT_RES:2128,SPOT:2131,
  ORDER_LIST_REQ:2175,ORDER_LIST_RES:2176,ORDER_DETAILS_REQ:2181,ORDER_DETAILS_RES:2182,
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
  call(type,expected,payload,onSent){
    requireV3(this.socket?.readyState===this.WebSocketClass.OPEN,'NOT_CONNECTED','Sem ligação à cTrader.',503);
    const id='gb3-'+(++this.seq);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiters.delete(id);reject(new V3Error('TIMEOUT','Confirma o estado na corretora antes de tentar outra operação.',504));},this.timeout);
      this.waiters.set(id,{expected,resolve,reject,timer});
      try{this.socket.send(JSON.stringify({clientMsgId:id,payloadType:type,payload}));}
      catch{clearTimeout(timer);this.waiters.delete(id);reject(new V3Error('SEND_FAILED','Falha de comunicação com cTrader.',503));return;}
      onSent?.();
    });
  }
  async spot(accountId,symbolId){
    const key=String(symbolId);
    const spotPromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.spots.delete(key);reject(new V3Error('NO_QUOTE','Cotação atual indisponível.',503));},7000);
      this.spots.set(key,{resolve,reject,timer});
    });
    let row;
    try{
      [,row]=await Promise.all([
        Promise.resolve().then(()=>this.call(PT.SPOT_REQ,PT.SPOT_RES,{
          ctidTraderAccountId:accountId,symbolId:[symbolId],subscribeToSpotTimestamp:true
        })),
        spotPromise
      ]);
    }finally{
      clearTimeout(this.spots.get(key)?.timer);
      this.spots.delete(key);
    }
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
  requireV3(String(positions.ctidTraderAccountId)===String(id),
    'ACCOUNT_MISMATCH','A resposta pertence a outra conta DEMO.',502);
  // Fail closed for ANY pre-existing broker position or pending order.
  requireV3((positions.position||[]).length===0 && (positions.order||[]).length===0,
    'EXPOSURE','Já existem posições ou ordens na conta demo; o GoldBot não irá abrir outras.');
  const matched=(symbols.symbol||[]).filter(v=>
    String(v.symbolName||'').toUpperCase().replace('/','')==='XAUUSD'&&v.enabled!==false);
  requireV3(matched.length===1,'SYMBOL','XAUUSD indisponível ou ambíguo na corretora.');
  const brief=matched[0];
  const detail=await s.call(PT.SYMBOL_REQ,PT.SYMBOL_RES,{ctidTraderAccountId:id,symbolId:[brief.symbolId]});
  const full=(detail.symbol||[]).find(x=>String(x.symbolId)===String(brief.symbolId));
  requireV3(full&&full.digits!=null&&Number.isInteger(Number(full.digits))&&Number(full.digits)>=0&&Number(full.digits)<=10,'SYMBOL_PROFILE','Metadados do instrumento indisponíveis.');
  const quote=await s.spot(id,brief.symbolId);
  const plan=sizeDemoBuy({balance,currency,eurUsd,ask:quote.ask,bid:quote.bid,close,
    volMin:Number(full.minVolume),volMax:Number(full.maxVolume),volStep:Number(full.stepVolume),
    limitedRisk,tradable:full.tradingMode===0||full.tradingMode==null});
  return {quote,plan:{...plan,digits:full.digits},symbolId:brief.symbolId,brokerSymbol:brief.symbolName};
}
const executionStates = {2:'ACCEPTED',3:'FILLED',4:'REPLACED',5:'CANCELLED',
  6:'EXPIRED',7:'REJECTED',11:'PARTIALLY_FILLED'};
const orderStates = {1:'ACCEPTED',2:'FILLED',3:'REJECTED',4:'EXPIRED',5:'CANCELLED'};
const terminalStates = ['FILLED','REJECTED','EXPIRED','CANCELLED'];

export function demoOrderIntent(ctx,{symbolId,plan,uid,date}){
  return {uid,date,accountId:String(ctx.accountId),symbolId,volume:plan.volume,
    relativeStopLoss:plan.relativeStopLoss,relativeTakeProfit:plan.relativeTakeProfit,
    priceTick:10 ** -plan.digits,
    clientOrderId:`GB3-${uid}-${date.replaceAll('-','')}`,submittedAt:Date.now(),
    status:'SUBMITTING',resolved:false};
}

export async function submitDemoBuy(ctx,intent,onSent){
  requireV3(isDemoAccount(ctx.account),'LIVE_BLOCK','Apenas contas DEMO são permitidas.',403);
  requireV3(isTradeScope(ctx.scope),'VIEW_ONLY','Falta autorizar negociação na cTrader.',403);
  const {symbolId,volume,relativeStopLoss,relativeTakeProfit,clientOrderId}=intent;
  const event=await ctx.socket.call(PT.NEW_ORDER,PT.EXECUTION,{
    ctidTraderAccountId:ctx.accountId,symbolId,orderType:1,tradeSide:1,volume,
    relativeStopLoss,relativeTakeProfit,clientOrderId,label:'GOLDBOT-DEMO-V3',
    comment:'Conta demonstracao, estrategia diaria automatica'},onSent);
  const matches=String(event.ctidTraderAccountId)===intent.accountId &&
    (!event.order?.clientOrderId || event.order.clientOrderId===clientOrderId);
  return {...intent,orderSent:true,status:matches?(executionStates[event.executionType]||'UNKNOWN'):'UNKNOWN',
    orderId:matches&&event.order?.orderId!=null?String(event.order.orderId):null};
}

export async function reconcileDemoOrder(ctx,intent){
  requireV3(isDemoAccount(ctx.account)&&String(ctx.accountId)===intent.accountId,
    'ACCOUNT_MISMATCH','A intenção pertence a outra conta DEMO.',403);
  const account={ctidTraderAccountId:ctx.accountId};
  const read=async(type,expected,params={})=>{
    const reply=await ctx.socket.call(type,expected,{...account,...params});
    requireV3(String(reply.ctidTraderAccountId)===intent.accountId,
      'ACCOUNT_MISMATCH','A resposta pertence a outra conta DEMO.',502);
    return reply;
  };

  const matching=order=>intent.orderId
    ? String(order.orderId)===intent.orderId
    : order.clientOrderId===intent.clientOrderId;
  let orderId=intent.orderId;
  if(!orderId){
    const pending=((await read(PT.RECONCILE_REQ,PT.RECONCILE_RES)).order||[]).filter(matching);
    const candidates=pending.length?pending:(await read(PT.ORDER_LIST_REQ,PT.ORDER_LIST_RES,{
      fromTimestamp:Math.max(0,intent.submittedAt-60_000),toTimestamp:Date.now()
    })).order?.filter(matching)||[];
    if(candidates.length!==1 || candidates[0].orderId==null)return intent;
    orderId=String(candidates[0].orderId);
  }
  const {order}=await read(PT.ORDER_DETAILS_REQ,PT.ORDER_DETAILS_RES,{orderId});
  requireV3(order && String(order.orderId)===orderId &&
    (!order.clientOrderId||order.clientOrderId===intent.clientOrderId) &&
    String(order.tradeData?.symbolId)===String(intent.symbolId) &&
    Number(order.tradeData?.tradeSide)===1 && Number(order.tradeData?.volume)===intent.volume,
    'ORDER_MISMATCH','Os dados da ordem DEMO não correspondem à intenção.',502);
  const executedVolume=Number(order.executedVolume??0);
  requireV3(Number.isSafeInteger(executedVolume)&&executedVolume>=(intent.executedVolume??0)&&executedVolume<=intent.volume,
    'ORDER_VOLUME','Volume executado inválido.',502);
  let status=orderStates[order.orderStatus]||'UNKNOWN';
  if(status==='ACCEPTED'&&executedVolume>0)status='PARTIALLY_FILLED';
  requireV3(status!=='FILLED'||executedVolume===intent.volume,
    'ORDER_VOLUME','Execução total sem confirmação do volume solicitado.',502);
  requireV3((intent.status!=='FILLED'||status==='FILLED')&&
    (intent.status!=='PARTIALLY_FILLED'||executedVolume>0),
    'ORDER_STATE','A corretora devolveu um estado incompatível com a execução observada.',502);
  const positions=executedVolume>0?(await read(PT.RECONCILE_REQ,PT.RECONCILE_RES)).position||[]:[];
  const position=positions.find(p=>order.positionId!=null &&
    String(p.positionId)===String(order.positionId));
  const entry=Number(position?.price), stopLoss=Number(position?.stopLoss), takeProfit=Number(position?.takeProfit);
  const protectionVerified=Boolean(position && entry>0 && stopLoss>0 && stopLoss<entry && takeProfit>entry &&
    String(position.tradeData?.symbolId)===String(intent.symbolId) &&
    Number(position.tradeData?.tradeSide)===1 && Number(position.tradeData?.volume)===executedVolume &&
    Math.abs(entry-stopLoss-intent.relativeStopLoss/100000)<=intent.priceTick &&
    Math.abs(takeProfit-entry-intent.relativeTakeProfit/100000)<=intent.priceTick);
  return {...intent,orderSent:true,orderId,status,executedVolume,positionId:order.positionId==null?null:String(order.positionId),
    protectionVerified,resolved:terminalStates.includes(status)&&(executedVolume===0||protectionVerified),
    reconciledAt:new Date().toISOString()};
}
