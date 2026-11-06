/** Tenant-scoped credentials, key authentication and encrypted demo OAuth tokens. */
import {randomBytes,createHash,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {readEnv} from './goldbot-services.mjs';
import {V3,V3Error,requireV3,safeKeyId,validDemoLogin} from './goldbot-v3-policy.mjs';
export const store=()=>getStore({name:'goldbot-v3-tenants',consistency:'strong'});
export const idFromKey=key=>typeof key==='string'&&/^gb3_([a-f0-9]{12})_[A-Za-z0-9_-]{40,64}$/.test(key)?key.split('_')[1]:null;
const digest=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const const keySeed=()=>String(readEnv('GOLDBOT_V3_DATA_KEY')||'').trim();||`${readEnv('CTRADER_CLIENT_SECRET')||''}\n${readEnv('GOLDBOT_V2_ADMIN_TOKEN')||''}`;
function encryptionKey(uid){
  const seed=keySeed();requireV3(seed.length>=32,'CONFIG','Segredo de encriptação não configurado.',503);
  return createHash('sha256').update(`goldbot-v3-demo\0${uid}\0${seed}`).digest();
}
export function protect(pair,uid){
  requireV3(typeof pair?.accessToken==='string'&&pair.accessToken.length>16&&typeof pair?.refreshToken==='string'&&pair.refreshToken.length>16,'TOKENS','Token incompleto.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(uid),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(pair),'utf8'),cipher.final()]);
  return {v:1,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),payload:ciphertext.toString('base64url')};
}
export function unprotect(record,uid){
  requireV3(record?.v===1,'NO_TOKENS','Conta ainda sem autorização cTrader.');
  try{
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(uid),Buffer.from(record.iv,'base64url'));
    decipher.setAuthTag(Buffer.from(record.tag,'base64url'));
    const pair=JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.payload,'base64url')),decipher.final()]).toString('utf8'));
    requireV3(typeof pair.accessToken==='string'&&typeof pair.refreshToken==='string','TOKENS','Tokens inválidos.');
    return pair;
  }catch{throw new V3Error('SEALED','Não foi possível recuperar as credenciais cTrader. Volta a autorizar a conta.',503);}
}
export const getTenant=async(uid,s=store())=>{requireV3(safeKeyId(uid),'BAD_UID','Utilizador inválido.');return s.get(`tenant/${uid}`,{type:'json'});};
export const saveTenant=async(uid,patch,s=store())=>{
  for(let n=0;n<4;n++){
    const prior=await s.getWithMetadata(`tenant/${uid}`,{type:'json'});
    requireV3(prior?.data,'NO_USER','Utilizador não encontrado.',404);
    const next={...prior.data,...patch};
    const r=await s.setJSON(`tenant/${uid}`,next,{onlyIfMatch:prior.etag});
    if(r.modified)return next;
  }
  throw new V3Error('BUSY','Alteração concorrente; tenta novamente.',409);
};
const adminToken=()= const adminToken=()=>String(readEnv('GOLDBOT_V3_AUTH_SECRET')||'').trim();||'');
export const isAdmin=req=>{
  const a=String(req.headers.get('Authorization')||'');
  const t=a.startsWith('Bearer ')?a.slice(7):'';
  const const secret=adminToken();return secret.length>=32&&equal(t,secret);
};
export const requireAdmin=req=>requireV3(isAdmin(req),'UNAUTHORIZED','Administração não autorizada.',401);
export const requireTenant=async(req,s=store())=>{
  const auth=String(req.headers.get('Authorization')||'');
  const key=auth.startsWith('Bearer ')?auth.slice(7):'';
  const uid=idFromKey(key);
  requireV3(uid,'UNAUTHORIZED','Chave individual inválida.',401);
  const user=await getTenant(uid,s);
  requireV3(user?.active===true&&equal(digest(key),user.keyHash),'UNAUTHORIZED','Chave individual inválida ou revogada.',401);
  return user;
};
export const publicTenant=u=>({id:u.id,name:u.name,active:u.active,createdAt:u.createdAt,
  account:u.account?{login:u.account.login,broker:u.account.broker,isLive:u.account.isLive,scope:u.account.scope}:null,
  armed:u.armed===true,lastDecision:u.lastDecision||null,lastCheck:u.lastCheck||null});
export async function createTenant(name,s=store()){
  requireV3(typeof name==='string'&&name.trim().length>=2&&name.trim().length<=55,'NAME','Nome entre 2 e 55 caracteres.');
  const index=(await s.get('tenant-index',{type:'json'}))||[];
  requireV3(index.length<V3.maxClients,'MAX_CLIENTS','Limite de 5 clientes do MVP atingido.');
  const uid=randomBytes(6).toString('hex');
  const key=`gb3_${uid}_${randomBytes(32).toString('base64url')}`;
  const t={id:uid,name:name.trim(),keyHash:digest(key),active:true,armed:false,account:null,createdAt:new Date().toISOString()};
  const created=await s.setJSON(`tenant/${uid}`,t,{onlyIfNew:true});
  requireV3(created.modified,'COLLISION','Tenta criar a chave novamente.');
  for(let n=0;n<4;n++){
    const prior=await s.getWithMetadata('tenant-index',{type:'json'});
    const list=prior?.data||[];
    if(list.length>=V3.maxClients)throw new V3Error('MAX_CLIENTS','Limite de clientes atingido.');
    const write=await s.setJSON('tenant-index',[...list,uid],prior?.etag?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
    if(write.modified)return {user:publicTenant(t),key};
  }
  // Fail closed: orphan user has no index/scheduled access. Admin may revoke by UID.
  throw new V3Error('BUSY','Registo concorrente; consulta a lista antes de criar novamente.',409);
}
export async function listTenants(s=store()){
  const ids=(await s.get('tenant-index',{type:'json'}))||[];
  const users=await Promise.all(ids.slice(0,V3.maxClients).map(id=>getTenant(id,s)));
  return users.filter(Boolean).map(publicTenant);
}
export async function startOAuth(user,login,s=store()){
  requireV3(validDemoLogin(login),'LOGIN','Indica o número da conta DEMO, sem espaços.');
  const clientId=String(readEnv('CTRADER_CLIENT_ID')||'').trim();
  requireV3(clientId,'CONFIG','CTRADER_CLIENT_ID não configurado.',503);
  const nonce=randomBytes(24).toString('base64url');
  const until=Date.now()+5*60_000;
  await s.setJSON(`oauth/${digest(nonce)}`,{uid:user.id,login,until,used:false},{onlyIfNew:true});
  const redirectUri='https://tradeplataform.netlify.app/.netlify/functions/goldbot-v3-oauth';
  const url=new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');
  for(const [k,v] of Object.entries({client_id:clientId,redirect_uri:redirectUri,scope:'trading',product:'web'}))url.searchParams.set(k,v);
  const cookie=`gb_v3_oauth=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/.netlify/functions/goldbot-v3-oauth; Max-Age=300`;
  return {url:url.href,cookie,redirectUri};
}
export async function consumeOAuth(nonce,s=store()){
  requireV3(typeof nonce==='string'&&/^[A-Za-z0-9_-]{32}$/.test(nonce),'SESSION','Volta a iniciar a autorização no GoldBot.',401);
  const key=`oauth/${digest(nonce)}`;
  const row=await s.getWithMetadata(key,{type:'json'});
  requireV3(row?.data?.until>Date.now()&&!row.data.used,'EXPIRED','Autorização expirada. Repete a ligação.',401);
  const reserved=await s.setJSON(key,{...row.data,used:true},{onlyIfMatch:row.etag});
  requireV3(reserved.modified,'REPLAY','Esta autorização já foi utilizada.',409);
  return row.data;
}
export const v3Response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
export const v3ErrorResponse=e=>v3Response({error:e instanceof V3Error?e.message:'Serviço indisponível.',code:e instanceof V3Error?e.code:'UNAVAILABLE'},e instanceof V3Error?e.status:503);
