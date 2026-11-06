/** Scoped individual paper trading status. Never exposes cTrader or admin data. */
import {privateJSON} from '../lib/goldbot-auth.mjs';
import {authenticateClient,simStore} from '../lib/goldbot-users.mjs';
import {initialState} from '../lib/goldbot-core.mjs';
import {readEnv} from '../lib/goldbot-services.mjs';
export default async function handler(req){
  if(req.method!=='GET')return privateJSON({error:'Método não permitido'},405);
  try{
    const user=await authenticateClient(req);
    if(!user)return privateJSON({error:'Chave inválida ou revogada'},401);
    const store=simStore();
    const [state,control]=await Promise.all([
      store.get('state:'+user.id,{type:'json'}),store.get('control:'+user.id,{type:'json'})
    ]);
    return privateJSON({user:{id:user.id,name:user.name},
      enabled:readEnv('GOLDBOT_V2_ENABLED')==='true'&&control?.enabled===true,
      masterAvailable:readEnv('GOLDBOT_V2_ENABLED')==='true',
      state:state?.version===2?state:initialState(),
      notice:'Simulação individual. Não possui acesso à conta cTrader de outra pessoa nem envia ordens.'});
  }catch{return privateJSON({error:'Consulta indisponível'},503)}
}
