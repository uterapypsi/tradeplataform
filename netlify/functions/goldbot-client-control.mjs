/** Each client controls ONLY their own paper simulation. */
import {privateJSON} from '../lib/goldbot-auth.mjs';
import {authenticateClient,simStore} from '../lib/goldbot-users.mjs';
import {readEnv} from '../lib/goldbot-services.mjs';
export default async function handler(req){
  if(req.method!=='POST')return privateJSON({error:'Método não permitido'},405);
  try{
    const user=await authenticateClient(req);
    if(!user)return privateJSON({error:'Chave inválida ou revogada'},401);
    const data=await req.json();
    if(typeof data?.enabled!=='boolean'||Object.keys(data).length!==1)return privateJSON({error:'Pedido inválido'},400);
    if(data.enabled&&readEnv('GOLDBOT_V2_ENABLED')!=='true')return privateJSON({error:'Motor global indisponível'},409);
    await simStore().setJSON('control:'+user.id,{enabled:data.enabled,at:new Date().toISOString()});
    return privateJSON({ok:true,enabled:data.enabled});
  }catch{return privateJSON({error:'Não foi possível alterar o estado'},503)}
}
