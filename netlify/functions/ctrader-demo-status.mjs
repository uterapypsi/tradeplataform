/**
 * cTrader Open API (DEMO), strictly read-only.
 * Reads the four CTRADER_* Netlify secrets on the server, never exposes them.
 * Only requests application auth (2100), account list (2149), account auth (2102)
 * and trader snapshot (2121). No order, position-change or trading commands.
 */
import {isAuthorized, privateJSON} from '../lib/goldbot-auth.mjs';
import {readEnv} from '../lib/goldbot-services.mjs';

const ENDPOINT='wss://demo.ctraderapi.com:5036';
const LOGIN='10134087'; // cTrader's visible broker login, NOT ctidTraderAccountId.
const TYPES=Object.freeze({
  APP_AUTH_REQ:2100, APP_AUTH_RES:2101,
  ACCOUNT_AUTH_REQ:2102, ACCOUNT_AUTH_RES:2103,
  TRADER_REQ:2121, TRADER_RES:2122,
  ERROR:2142, ACCOUNT_LIST_REQ:2149, ACCOUNT_LIST_RES:2150,
  HEARTBEAT:51,
});

// Error messages intentionally avoid credentials, raw frames and broker payloads.
class StatusError extends Error {
  constructor(code,message){ super(message); this.code=code; }
}

const cleanValue=value=>typeof value==='string'?value.trim():'';
const isViewScope=value=>value===0||value==='0'||value==='SCOPE_VIEW';
const parseDecimal=(raw,digits)=>{
  if(!Number.isInteger(Number(digits))||Number(digits)<0||Number(digits)>12)return null;
  const amount=Number(raw)/10**Number(digits);
  return Number.isFinite(amount)?amount:null;
};

async function readDemoAccount(config,{WebSocketClass=WebSocket,timeoutMs=13500}={}) {
  const socket=new WebSocketClass(ENDPOINT);
  let waiting=null;
  let rejectOpen=null;
  let seq=0;
  let killed=false;
  let heartbeat;
  const rejectPending=error=>{if(waiting){const w=waiting;waiting=null;w.reject(error);}};
  const clean=()=>{
    if(killed)return;
    killed=true;
    clearInterval(heartbeat);
    rejectPending(new StatusError('CONNECTION_CLOSED','Ligação à cTrader terminada'));
    try{socket.close();}catch{}
  };
  const onError=()=>rejectPending(new StatusError('CONNECTION_ERROR','Não foi possível comunicar com a cTrader'));
  socket.addEventListener('error',onError);
  socket.addEventListener('close',onError);
  socket.addEventListener('message',event=>{
    let frame;
    try{frame=JSON.parse(typeof event.data==='string'?event.data:'');}catch{return;}
    if(!waiting)return;
    if(frame.payloadType===TYPES.ERROR){
      rejectPending(new StatusError('CTRADER_REJECTED',
        `A cTrader rejeitou o pedido (${String(frame.payload?.errorCode||'erro desconhecido').slice(0,55)})`));
      return;
    }
    if(frame.clientMsgId!==waiting.id) return;
    if(frame.payloadType!==waiting.responseType){
      rejectPending(new StatusError('UNEXPECTED_REPLY','Resposta inesperada da cTrader'));
      return;
    }
    const w=waiting;waiting=null;w.resolve(frame.payload||{});
  });
  const timeout=setTimeout(()=>{
    const timeoutError=new StatusError('TIMEOUT','A cTrader não respondeu a tempo');
    if(rejectOpen){const fail=rejectOpen;rejectOpen=null;fail(timeoutError);}
    rejectPending(timeoutError);
    try{socket.close();}catch{}
  },timeoutMs);
  try{
    await new Promise((resolve,reject)=>{
      if(socket.readyState===WebSocketClass.OPEN)return resolve();
      rejectOpen=reject;
      socket.addEventListener('open',()=>{rejectOpen=null;resolve();},{once:true});
      socket.addEventListener('error',()=>{rejectOpen=null;reject(new StatusError('CONNECTION_ERROR','Não foi possível abrir ligação à cTrader'));},{once:true});
      socket.addEventListener('close',()=>{if(rejectOpen){rejectOpen=null;reject(new StatusError('CONNECTION_CLOSED','A cTrader terminou a ligação'));}},{once:true});
    });
    heartbeat=setInterval(()=>{
      if(socket.readyState===WebSocketClass.OPEN){
        try{socket.send(JSON.stringify({payloadType:TYPES.HEARTBEAT,payload:{}}));}catch{}
      }
    },9000);
    const call=(requestType,responseType,payload)=>new Promise((resolve,reject)=>{
      if(waiting)return reject(new StatusError('BUSY','Pedido cTrader já em curso'));
      const id=`g2-${++seq}-${Math.random().toString(36).slice(2)}`;
      waiting={id,responseType,resolve,reject};
      try{socket.send(JSON.stringify({clientMsgId:id,payloadType:requestType,payload}));}
      catch{waiting=null;reject(new StatusError('CONNECTION_ERROR','Não foi possível enviar pedido'))}
    });
    await call(TYPES.APP_AUTH_REQ,TYPES.APP_AUTH_RES,{clientId:config.clientId,clientSecret:config.clientSecret});
    const listed=await call(TYPES.ACCOUNT_LIST_REQ,TYPES.ACCOUNT_LIST_RES,{accessToken:config.accessToken});
    if(!isViewScope(listed.permissionScope))
      throw new StatusError('SCOPE_MISMATCH','Token sem permissão exclusiva de consulta. Volta a autorizar em Account info.');
    const accounts=Array.isArray(listed.ctidTraderAccount)?listed.ctidTraderAccount:[];
    const account=accounts.find(a=>String(a.traderLogin)===LOGIN && a.isLive!==true && a.isLive!=='true');
    if(!account)throw new StatusError('ACCOUNT_NOT_FOUND','O token não tem acesso à conta demo 10134087. Autoriza essa conta no cTrader ID correto.');
    const id=account.ctidTraderAccountId;
    if(id==null)throw new StatusError('MISSING_ID','A cTrader não devolveu o identificador interno da conta');
    await call(TYPES.ACCOUNT_AUTH_REQ,TYPES.ACCOUNT_AUTH_RES,{ctidTraderAccountId:id,accessToken:config.accessToken});
    const traderData=await call(TYPES.TRADER_REQ,TYPES.TRADER_RES,{ctidTraderAccountId:id});
    const t=traderData.trader||{};
    if(String(t.traderLogin||LOGIN)!==LOGIN)throw new StatusError('ACCOUNT_MISMATCH','A conta recebida não corresponde à demo escolhida');
    return {
      connected:true,
      environment:'demo', permission:'view',
      broker:cleanValue(t.brokerName)||cleanValue(account.brokerTitleShort)||'IC Markets EU',
      login:LOGIN,
      accountType:t.accountType??null,
      balance:parseDecimal(t.balance,t.moneyDigits),
      balanceCurrency:'EUR', // Selected demo account is EUR. Verify in broker app.
      leverage:t.leverageInCents==null?null:Number(t.leverageInCents)/100,
      checkedAt:new Date().toISOString(),
      warning:'Consulta read-only. Não envia ordens e não altera o simulador do GoldBot.'
    };
  } finally {
    clearTimeout(timeout);
    clean();
  }
}

export default async function ctraderDemoStatus(request){
  if(request.method!=='GET')return privateJSON({error:'Método não permitido'},405);
  if(!isAuthorized(request))return privateJSON({error:'Não autorizado'},401);
  const clientId=cleanValue(readEnv('CTRADER_CLIENT_ID'));
  const clientSecret=cleanValue(readEnv('CTRADER_CLIENT_SECRET'));
  const accessToken=cleanValue(readEnv('CTRADER_DEMO_ACCESS_TOKEN'));
  const refreshToken=cleanValue(readEnv('CTRADER_DEMO_REFRESH_TOKEN'));
  if(!clientId||!clientSecret||!accessToken||!refreshToken)
    return privateJSON({error:'Uma ou mais credenciais cTrader não estão disponíveis no Functions/Production'},503);
  try{
    const result=await readDemoAccount({clientId,clientSecret,accessToken});
    return privateJSON(result);
  } catch(error){
    if(error instanceof StatusError)return privateJSON({error:error.message,code:error.code},502);
    return privateJSON({error:'Falha inesperada na consulta da conta demo. Verifica os logs Netlify, sem expor tokens.'},503);
  }
}

export {readDemoAccount, TYPES};
