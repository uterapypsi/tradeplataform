/** GoldBot AI 3: owner provisioning, per-user keys, explicit DEMO authorization. */
import {readEnv} from '../lib/goldbot-services.mjs';
import {V3Error,requireV3,canArm,safeKeyId} from '../lib/goldbot-v3-policy.mjs';
import {store,isAdmin,requireAdmin,requireTenant,createTenant,listTenants,getTenant,
  saveTenant,publicTenant,startOAuth,v3Response,v3ErrorResponse} from '../lib/goldbot-v3-store.mjs';
import {getUsableTenantToken,previewDaily,eurUsdDaily,runTenantDaily,getGlobalControl,globalDemoAllowed} from '../lib/goldbot-v3-runner.mjs';
import {withDemoBroker,getBrokerSnapshot} from '../lib/goldbot-v3-broker.mjs';

const noStore={CacheControl:'no-store'};
export default async function goldbotV3(req){
  const s=store();
  try{
    const url=new URL(req.url);
    if(req.method==='GET'){
      const master=await getGlobalControl(s);
      if(isAdmin(req))return v3Response({role:'admin',users:await listTenants(s),
        globalEnabled:globalDemoAllowed()&&master.enabled===true,environment:'demo'});
      const user=await requireTenant(req,s);
      const result={role:'user',user:publicTenant(user),environment:'demo',
        globalEnabled:globalDemoAllowed()&&master.enabled===true};
      if(url.searchParams.get('live')==='1' && user.account){
        const accessToken=await getUsableTenantToken(user.id,s);
        const clientId=String(readEnv('CTRADER_CLIENT_ID')||'').trim();
        const clientSecret=String(readEnv('CTRADER_CLIENT_SECRET')||'').trim();
        result.demo=await withDemoBroker({clientId,clientSecret,accessToken,login:user.account.login,
          accountId:user.account.accountId,tradeRequired:false},getBrokerSnapshot);
        await saveTenant(user.id,{lastCheck:result.demo.checkedAt},s);
      }
      return v3Response(result);
    }
    requireV3(req.method==='POST','METHOD','Método não permitido.',405);
    requireV3((req.headers.get('content-type')||'').startsWith('application/json'),'JSON','Enviar JSON.');
    const raw=await req.text();requireV3(raw.length<=2048,'TOO_LARGE','Pedido inválido.');
    let data;try{data=JSON.parse(raw)}catch{throw new V3Error('JSON','JSON inválido.')};
    const action=String(data?.action||'');
    if(['create','revoke','master'].includes(action)){
      requireAdmin(req);
      if(action==='create')return v3Response(await createTenant(data.name,s),201);
      if(action==='revoke'){
        requireV3(safeKeyId(data.uid),'UID','Utilizador inválido.');
        await saveTenant(data.uid,{active:false,armed:false,account:null},s);
        await s.setJSON(`token/${data.uid}`,{revoked:true});
        return v3Response({ok:true,message:'Chave revogada e conta desligada.'});
      }
      requireV3(typeof data.enabled==='boolean','VALUE','Valor booleano obrigatório.');
      if(data.enabled){
        requireV3(data.confirmation==='ATIVAR DEMO','CONFIRM','Confirma a ativação exclusiva para DEMO.');
        requireV3(globalDemoAllowed(),'MASTER_ENV','A variável de segurança no Netlify está desativada.');
      }
      await s.setJSON('master',{enabled:data.enabled,changedAt:new Date().toISOString()});
      return v3Response({ok:true,enabled:data.enabled,message:data.enabled?'Execução DEMO permitida pelo administrador.':'Pausa de emergência global ativada.'});
    }
    const user=await requireTenant(req,s);
    if(action==='oauth-start'){
      const started=await startOAuth(user,String(data.login||''),s);
      return v3Response({authorizeUrl:started.url,notice:'A cTrader pedirá autorização exclusiva para a conta demo escolhida.'},200,{'Set-Cookie':started.cookie});
    }
    if(action==='pause'){
      await saveTenant(user.id,{armed:false},s);
      return v3Response({ok:true,armed:false,message:'Agente DEMO pausado.'});
    }
    if(action==='arm'){
      requireV3(data.confirmation==='ATIVAR DEMO','CONFIRM','Confirma explicitamente a negociação na conta DEMO.');
      const master=await getGlobalControl(s);
      canArm({user,globalEnabled:globalDemoAllowed()&&master.enabled===true,
        connected:Boolean(user.account),scope:user.account?.scope});
      await saveTenant(user.id,{armed:true},s);
      return v3Response({ok:true,armed:true,message:'Conta DEMO armada para executar somente sinais válidos, respeitando os limites de risco.'});
    }
    if(action==='run-once'){
      requireV3(data.confirmation==='EXECUTAR DEMO','CONFIRM','Confirma o ciclo exclusivamente DEMO.');
      const master=await getGlobalControl(s);
      canArm({user,globalEnabled:globalDemoAllowed()&&master.enabled===true,
        connected:Boolean(user.account),scope:user.account?.scope});
      requireV3(user.armed===true,'PAUSED','O agente deste cliente está pausado.');
      const signal=await previewDaily();
      if(signal.action!=='BUY')return v3Response({orderSent:false,...signal});
      const fx=await eurUsdDaily();
      const outcome=await runTenantDaily(user.id,{signal,fx,s});
      return v3Response({orderSent:outcome.action==='BUY_DEMO',...outcome});
    }
    if(action==='preview'){
      const signal=await previewDaily();
      return v3Response({preview:true,orderSent:false,...signal});
    }
    throw new V3Error('ACTION','Ação desconhecida.',404);
  }catch(e){return v3ErrorResponse(e)}
}
