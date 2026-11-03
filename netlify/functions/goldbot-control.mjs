/* Start/pause the simulated scheduler, protected by a secret set in Netlify.
   GOLDBOT_V2_ENABLED is a separate, mandatory server-side master switch. */
import {getStore} from '@netlify/blobs';
import {isAuthorized, privateJSON} from '../lib/goldbot-auth.mjs';
import {readEnv} from '../lib/goldbot-services.mjs';
export default async request=>{
  if(request.method!=='POST')return privateJSON({error:'Método não permitido'},405);
  if(!isAuthorized(request))return privateJSON({error:'Não autorizado'},401);
  if(readEnv('GOLDBOT_V2_ENABLED')!=='true')return privateJSON({error:'Ativa primeiro GOLDBOT_V2_ENABLED no Netlify'},409);
  let j;
  try {j=await request.json();} catch {return privateJSON({error:'JSON inválido'},400);}
  if(typeof j?.enabled!=='boolean'||Object.keys(j).length!==1) return privateJSON({error:'Pedido inválido'},400);
  try{
    const store=getStore({name:'goldbot-v2',consistency:'strong'});
    await store.setJSON('control',{enabled:j.enabled,changedAt:new Date().toISOString()});
    return privateJSON({ok:true,requestedEnabled:j.enabled,
      message:j.enabled?'Ativo: apenas simulação; próximo ciclo programado':'Pausado: não serão feitas novas análises agendadas'});
  }catch{return privateJSON({error:'Falha ao alterar o controlo'},503);}
};
