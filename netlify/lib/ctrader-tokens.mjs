/**
 * Private cTrader OAuth rotation with encrypted Netlify Blob persistence.
 * Old cTrader access AND refresh tokens become invalid when refreshed.
 * No token is ever logged, returned to clients, or committed to GitHub.
 */
import {randomUUID,randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {readEnv} from './goldbot-services.mjs';

const STORE='ctrader-demo-private-v2';
const KEY='oauth-tokens';
const LOCK='oauth-refresh-lock';
const SAFE_WINDOW_MS=7*24*60*60*1000;
const LOCK_MS=25_000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class CTraderError extends Error {
  constructor(code,message){super(message);this.name='CTraderError';this.code=code;}
}
export const getDemoStore=()=>getStore({name:STORE,consistency:'strong'});
export function getClientCredentials(){
  const clientId=String(readEnv('CTRADER_CLIENT_ID')||'').trim();
  const clientSecret=String(readEnv('CTRADER_CLIENT_SECRET')||'').trim();
  const envAccess=String(readEnv('CTRADER_DEMO_ACCESS_TOKEN')||'').trim();
  const envRefresh=String(readEnv('CTRADER_DEMO_REFRESH_TOKEN')||'').trim();
  const adminSecret=String(readEnv('GOLDBOT_V2_ADMIN_TOKEN')||'').trim();
  if(!clientId||!clientSecret||!envAccess||!envRefresh||adminSecret.length<24)
    throw new CTraderError('CONFIG_MISSING','Confirma as quatro credenciais cTrader e a chave privada de administrador no Netlify.');
  return {clientId,clientSecret,envAccess,envRefresh,adminSecret};
}
const isPair=x=>Boolean(x&&typeof x.accessToken==='string'&&x.accessToken.length>8&&typeof x.refreshToken==='string'&&x.refreshToken.length>8);
const fingerprint=creds=>createHash('sha256').update(creds.envRefresh).digest('hex');
const encryptionKey=creds=>createHash('sha256').update('goldbot/ctrader/demo/token-encryption/v2\0').update(creds.clientSecret).update('\0').update(creds.adminSecret).digest();
function seal(pair,creds){
  if(!isPair(pair))throw new CTraderError('TOKEN_SAVE_FAILED','Par de tokens inválido.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(creds),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify({accessToken:pair.accessToken,refreshToken:pair.refreshToken}),'utf8'),cipher.final()]);
  return {version:2,envFingerprint:fingerprint(creds),expiresAt:pair.expiresAt,rotatedAt:pair.rotatedAt,
    sealed:{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}};
}
function unseal(record,creds){
  if(!record||record.version!==2||record.envFingerprint!==fingerprint(creds))return null;
  try{
    const s=record.sealed;
    if(!s||typeof s.iv!=='string'||typeof s.tag!=='string'||typeof s.ciphertext!=='string')throw Error('Invalid structure');
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(creds),Buffer.from(s.iv,'base64'));
    decipher.setAuthTag(Buffer.from(s.tag,'base64'));
    const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(s.ciphertext,'base64')),decipher.final()]).toString('utf8'));
    if(!isPair(data))throw Error('Invalid token pair');
    return {...data,expiresAt:record.expiresAt,rotatedAt:record.rotatedAt};
  }catch{
    throw new CTraderError('STORAGE_INVALID','Não foi possível recuperar os tokens protegidos. Se alteraste a chave administrativa, volta a autorizar a conta demo.');
  }
}
const isFresh=x=>isPair(x)&&Number.isFinite(x.expiresAt)&&x.expiresAt-Date.now()>SAFE_WINDOW_MS;

/** Refresh only on the server. The official cTrader REST endpoint expects POST/query parameters. */
export async function refreshOAuth(creds,refreshToken,{fetcher=fetch}={}){
  const url=new URL('https://openapi.ctrader.com/apps/token');
  for(const [k,v] of Object.entries({grant_type:'refresh_token',refresh_token:refreshToken,client_id:creds.clientId,client_secret:creds.clientSecret}))url.searchParams.set(k,v);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000);
  try{
    const response=await fetcher(url,{method:'POST',headers:{Accept:'application/json'},signal:controller.signal,redirect:'error',cache:'no-store'});
    if(!response.ok)throw new CTraderError('TOKEN_REFRESH_FAILED','A cTrader recusou a renovação do token.');
    const data=await response.json();
    if(data.errorCode||!isPair(data))throw new CTraderError('TOKEN_REFRESH_FAILED','A cTrader não devolveu um par de tokens válido.');
    const seconds=Number(data.expiresIn);
    if(!Number.isFinite(seconds)||seconds<300||seconds>5_000_000)throw new CTraderError('BAD_TOKEN_EXPIRY','Resposta inesperada do prazo do token.');
    return {accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+seconds*1000,rotatedAt:new Date().toISOString()};
  }catch(error){
    if(error instanceof CTraderError)throw error;
    throw new CTraderError('TOKEN_REFRESH_NETWORK','Não foi possível renovar o token junto da cTrader.');
  }finally{clearTimeout(timer)}
}

async function getLock(store){return store.getWithMetadata(LOCK,{type:'json'});}
async function takeLock(store){
  for(let attempt=0;attempt<12;attempt++){
    const prior=await getLock(store);
    if(prior?.data?.until>Date.now()){await sleep(400);continue;}
    const holder=randomUUID();
    const options=prior?.etag?{onlyIfMatch:prior.etag}:{onlyIfNew:true};
    const result=await store.setJSON(LOCK,{holder,until:Date.now()+LOCK_MS},options);
    if(result.modified)return holder;
    await sleep(200);
  }
  throw new CTraderError('REFRESH_BUSY','A renovação já está em curso. Tenta consultar novamente.');
}
async function releaseLock(store,holder){
  try{
    const prior=await getLock(store);
    if(prior?.data?.holder===holder&&prior.etag)await store.setJSON(LOCK,{holder:null,until:0},{onlyIfMatch:prior.etag});
  }catch{/* Lease also expires if best-effort release fails. */}
}

/** Return decrypted pair only in server memory; persist new pairs AES-GCM encrypted. */
export async function getUsableTokens(store,creds){
  const initial=await store.getWithMetadata(KEY,{type:'json'});
  const current=unseal(initial?.data,creds);
  if(isFresh(current))return current;
  const holder=await takeLock(store);
  try{
    const prior=await store.getWithMetadata(KEY,{type:'json'});
    const latest=unseal(prior?.data,creds);
    if(isFresh(latest))return latest;
    const rotated=await refreshOAuth(creds,latest?.refreshToken||creds.envRefresh);
    const options=prior?.etag?{onlyIfMatch:prior.etag}:{onlyIfNew:true};
    const result=await store.setJSON(KEY,seal(rotated,creds),options);
    if(!result.modified){
      const winner=unseal(await store.get(KEY,{type:'json'}),creds);
      if(isFresh(winner))return winner;
      throw new CTraderError('TOKEN_SAVE_CONFLICT','Não foi possível confirmar a gravação do token novo.');
    }
    return rotated;
  }finally{await releaseLock(store,holder)}
}
