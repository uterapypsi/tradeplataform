/** Admin-only provisioning. Each key is returned only at creation. */
import {isAuthorized,privateJSON} from '../lib/goldbot-auth.mjs';
import {createClient,listClients,revokeClient} from '../lib/goldbot-users.mjs';
export default async function handler(req){
  if(!isAuthorized(req))return privateJSON({error:'Não autorizado'},401);
  try{
    if(req.method==='GET')return privateJSON({users:await listClients()});
    if(req.method!=='POST')return privateJSON({error:'Método não permitido'},405);
    if(Number(req.headers.get('content-length')||0)>4096)return privateJSON({error:'Pedido demasiado grande'},413);
    const data=await req.json();
    if(data?.action==='create'&&Object.keys(data).sort().join(',')==='action,name'){
      const result=await createClient(data.name);
      return privateJSON({ok:true,...result,warning:'Guarda a chave agora: não pode ser consultada novamente.'},201);
    }
    if(data?.action==='revoke'&&Object.keys(data).sort().join(',')==='action,id')return privateJSON({ok:true,...await revokeClient(data.id)});
    return privateJSON({error:'Pedido inválido'},400);
  }catch(e){return privateJSON({error:String(e.message||'Falha').slice(0,160)},400)}
}
