/** GoldBot 3 DEMO-only signal, token refresh, and scheduled execution. */
import {randomBytes} from 'node:crypto';
import {readEnv,fetchGoldSeries,fetchHeadlines,fetchLimited} from './goldbot-services.mjs';
import {evaluate} from '../../public/engine.js';
import {riskGate,summarizeNews} from '../../public/intelligence.js';
import {V3,V3Error,requireV3,lastClosedBars,evaluateSignal,canArm} from './goldbot-v3-policy.mjs';
import {store,getTenant,saveTenant,unprotect,protect} from './goldbot-v3-store.mjs';
import {withDemoBroker,getBrokerSnapshot,prepareBuy,submitDemoBuy} from './goldbot-v3-broker.mjs';
const clientCreds=()=>{
  const clientId=String(readEnv('CTRADER_CLIENT_ID')||'').trim();
  const clientSecret=String(readEnv('CTRADER_CLIENT_SECRET')||'').trim();
  requireV3(clientId&&clientSecret,'CONFIG','Credenciais da aplicação cTrader não configuradas.',503);
  return {clientId,clientSecret};
};
const tokenUrl=fields=>{
  const url=new URL('https://openapi.ctrader.com/apps/token');
  for(const [k,v] of Object.entries(fields))url.searchParams.set(k,v);
  return url;
};
async function exchange(fields,fetcher=fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);
  try{
    const res=await fetcher(tokenUrl(fields),{method:'GET',headers:{Accept:'application/json'},cache:'no-store',redirect:'error',signal:controller.signal});
    requireV3(res.ok,'OAUTH_FAILED','A cTrader não conseguiu concluir a autorização.',502);
    const data=await res.json();
    requireV3(!data.errorCode&&typeof data.accessToken==='string'&&typeof data.refreshToken==='string'&&Number(data.expiresIn)>300,
      'OAUTH_FAILED','A autorização cTrader não devolveu credenciais válidas.',502);
    return {accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+Number(data.expiresIn)*1000};
  }catch(e){if(e instanceof V3Error)throw e;throw new V3Error('OAUTH_NETWORK','Sem resposta da cTrader para autorização.',503);}
  finally{clearTimeout(timer);}
}
export const exchangeCode=async(code,redirectUri,fetcher=fetch)=>{
  requireV3(typeof code==='string'&&code.length>=12&&code.length<=1024,'CODE','Código cTrader inválido.');
  const creds=clientCreds();
  return exchange({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:creds.clientId,client_secret:creds.clientSecret},fetcher);
};
export async function linkTenantDemo({uid,login,pair}){
  const creds=clientCreds();
  // Check requested demo account AND trading permissions before persisting tokens.
  const snapshot=await withDemoBroker({...creds,accessToken:pair.accessToken,login,tradeRequired:true},getBrokerSnapshot);
  requireV3(snapshot.currency==='EUR'||snapshot.currency==='USD','CURRENCY','A conta demo precisa ser EUR ou USD.');
  const s=store();
  await s.setJSON(`token/${uid}`,protect(pair,uid));
  await saveTenant(uid,{initialBalance:snapshot.balance,account:{login:snapshot.login,accountId:snapshot.accountId,
    isLive:false,scope:snapshot.scope,broker:'cTrader Demo',currency:snapshot.currency},
    armed:false,lastCheck:snapshot.checkedAt},s);
  return {login:snapshot.login,currency:snapshot.currency,checkedAt:snapshot.checkedAt};
}
export async function getUsableTenantToken(uid,s=store()){
  const read=await s.getWithMetadata(`token/${uid}`,{type:'json'});
  requireV3(read?.data,'NOT_LINKED','Conta demo ainda não vinculada.',409);
  const pair=unprotect(read.data,uid);
  if(Number.isFinite(pair.expiresAt)&&pair.expiresAt-Date.now()>7*86_400_000)return pair.accessToken;
  // CAS lock prevents two calls rotating the same one-time refresh token.
  const lockKey=`refresh-lock/${uid}`;
  const state=await s.getWithMetadata(lockKey,{type:'json'});
  const now=Date.now();
  requireV3(!(state?.data?.until>now),'REFRESH_BUSY','Renovação em curso. Tenta novamente.',409);
  const owner=randomBytes(12).toString('hex');
  const lock=await s.setJSON(lockKey,{owner,until:now+30_000},state?.etag?{onlyIfMatch:state.etag}:{onlyIfNew:true});
  requireV3(lock.modified,'REFRESH_BUSY','Renovação simultânea detectada.',409);
  try{
    const reread=await s.getWithMetadata(`token/${uid}`,{type:'json'});
    const latest=unprotect(reread.data,uid);
    if(Number.isFinite(latest.expiresAt)&&latest.expiresAt-Date.now()>7*86_400_000)return latest.accessToken;
    const creds=clientCreds();
    const rotated=await exchange({grant_type:'refresh_token',refresh_token:latest.refreshToken,client_id:creds.clientId,client_secret:creds.clientSecret});
    const saved=await s.setJSON(`token/${uid}`,protect(rotated,uid),{onlyIfMatch:reread.etag});
    requireV3(saved.modified,'ROTATION_RACE','Não foi possível guardar o novo token. Reautoriza a conta.');
    return rotated.accessToken;
  }finally{
    try{
      const row=await s.getWithMetadata(lockKey,{type:'json'});
      if(row?.data?.owner===owner)await s.setJSON(lockKey,{owner:null,until:0},{onlyIfMatch:row.etag});
    }catch{}
  }
}
export async function previewDaily({now=new Date().toISOString(),bars,headlines,newsAvailable}={}){
  const series=bars??await fetchGoldSeries(readEnv('TWELVE_DATA_API_KEY'));
  const history=lastClosedBars(series,now);
  let news=headlines,available=newsAvailable;
  if(news==null){
    try{news=await fetchHeadlines();available=true;}
    catch{news=[];available=false;}
  }
  const technical=evaluate('GOLD',history,{});
  const newsSummary=summarizeNews(news,new Date(now));
  const gate=riskGate('GOLD',news,{enabled:true,
    available:Boolean(available)&&newsSummary.recentCount>0,mode:'live',now:new Date(now)});
  const signal=evaluateSignal({bars:history,tech:technical,newsAllowed:!gate.blocked,newsReason:gate.reason});
  return {...signal,close:history.at(-1).c,confidence:technical.confidence,symbol:'XAUUSD',signalSource:'Twelve Data daily closed bar'};
}
export async function eurUsdDaily({now=new Date().toISOString()}={}){
  const key=String(readEnv('TWELVE_DATA_API_KEY')||'');
  requireV3(key,'FX_MISSING','Fonte de câmbio não configurada.',503);
  const url=new URL('https://api.twelvedata.com/time_series');
  Object.entries({symbol:'EUR/USD',interval:'1day',outputsize:'5',apikey:key}).forEach(([k,v])=>url.searchParams.set(k,v));
  const data=await(await fetchLimited(url)).json();
  const records=(data.values||[]).filter(x=>String(x.datetime||'')<now.slice(0,10));
  const latest=records.sort((a,b)=>String(b.datetime).localeCompare(String(a.datetime)))[0];
  const price=Number(latest?.close);
  const age=Date.parse(now)-Date.parse(`${latest?.datetime}T00:00:00.000Z`);
  requireV3(price>=0.75&&price<=1.6&&age>=0&&age<=4*86400000,'FX_STALE','EUR/USD desatualizado; operação bloqueada.');
  return price;
}
export const globalDemoAllowed=()=>String(readEnv('GOLDBOT_V3_ALLOW_DEMO_ORDERS')||'').toLowerCase()==='true';
export const getGlobalControl=async(s=store())=>(await s.get('master',{type:'json'}))||{enabled:false};
export async function runTenantDaily(uid,{signal,fx,now=new Date().toISOString(),s=store(),broker=withDemoBroker}={}){
  const tenant=await getTenant(uid,s);
  if(!tenant?.active||!tenant.armed)return {uid,action:'DISARMED'};
  const master=await getGlobalControl(s);
  canArm({user:tenant,globalEnabled:globalDemoAllowed()&&master.enabled===true,
    connected:Boolean(tenant.account),scope:tenant.account?.scope});
  const planSignal=signal??await previewDaily({now});
  if(planSignal.action!=='BUY')return {uid,...planSignal};
  const date=planSignal.date;
  const id=`intent/${uid}/${date}`;
  const reserved=await s.setJSON(id,{status:'RESERVED',date,uid,at:now},{onlyIfNew:true});
  if(!reserved.modified)return {uid,action:'DUPLICATE',date};
  // Once reserved, NEVER blindly retry, even on network error or unknown broker result.
  try{
    const latest=await getTenant(uid,s);
    const switchNow=await getGlobalControl(s);
    canArm({user:latest,globalEnabled:globalDemoAllowed()&&switchNow.enabled===true,
      connected:Boolean(latest.account),scope:latest.account?.scope});
    const accessToken=await getUsableTenantToken(uid,s);
    const creds=clientCreds();
    const result=await broker({...creds,accessToken,login:latest.account.login,accountId:latest.account.accountId,tradeRequired:true},async ctx=>{
      const snapshot=await getBrokerSnapshot(ctx);
      requireV3(snapshot.currency===latest.account.currency,'ACCOUNT_CHANGED','Moeda da conta demo alterada.');
      requireV3(Number.isFinite(latest.initialBalance)&&snapshot.balance>=latest.initialBalance*.98,
        'DRAWDOWN','Perda de saldo superior a 2% desde a ligação; negociações interrompidas.');
      requireV3(snapshot.accessRights===0||snapshot.accessRights==null,'RIGHTS','Corretora não permite negociação nesta conta.');
      const prepared=await prepareBuy(ctx,{close:planSignal.close??planSignal.lastClose??planSignal.closePrice,
        eurUsd:fx,balance:snapshot.balance,currency:snapshot.currency,limitedRisk:snapshot.isLimitedRisk});
      // Final global kill-switch read directly before transmitting request.
      const active=await getTenant(uid,s),guard=await getGlobalControl(s);
      canArm({user:active,globalEnabled:globalDemoAllowed()&&guard.enabled===true,
        connected:Boolean(active.account),scope:active.account?.scope});
      return submitDemoBuy(ctx,{symbolId:prepared.symbolId,plan:prepared.plan,uid,date});
    });
    await s.setJSON(id,{status:'CONFIRMED',uid,date,at:now,receipt:result});
    await saveTenant(uid,{lastDecision:{at:now,action:'BUY_DEMO',date,clientOrderId:result.clientOrderId}},s);
    return {uid,action:'BUY_DEMO',date,clientOrderId:result.clientOrderId};
  }catch(err){
    const code=err instanceof V3Error?err.code:'UNAVAILABLE';
    await s.setJSON(id,{status:'UNKNOWN_OR_BLOCKED',uid,date,at:now,code});
    await saveTenant(uid,{armed:false,lastDecision:{at:now,action:'STOPPED',date,code}},s);
    return {uid,action:'STOPPED',date,code};
  }
}
export async function runScheduledDemo(){
  const s=store(),master=await getGlobalControl(s);
  if(!globalDemoAllowed()||master.enabled!==true)return {status:'OFF'};
  const ids=(await s.get('tenant-index',{type:'json'}))||[];
  const clients=(await Promise.all(ids.slice(0,V3.maxClients).map(id=>getTenant(id,s)))).filter(x=>x?.active&&x.armed);
  if(!clients.length)return {status:'NO_ARMED_CLIENTS'};
  let signal;
  try{signal=await previewDaily();}catch{return {status:'SIGNAL_UNAVAILABLE'}};
  if(signal.action!=='BUY')return {status:'NO_SIGNAL',date:signal.date};
  let fx;
  try{fx=await eurUsdDaily();}catch{return {status:'FX_UNAVAILABLE'}};
  const outcomes=await Promise.allSettled(clients.map(t=>runTenantDaily(t.id,{signal,fx})));
  return {status:'FINISHED',checked:outcomes.length,summary:outcomes.map(x=>x.status==='fulfilled'?x.value.action:'ERROR')};
}
