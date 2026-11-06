/** Admin-only arm / stop for one DEMO trading account. Disabled by default. */
import {privateJSON,isAuthorized} from '../lib/goldbot-auth.mjs';
import {tradeConfigStatus,tradeControl,setTradeControl} from '../lib/goldbot-demo-trader.mjs';
export default async function handler(request){
  if(!isAuthorized(request))return privateJSON({error:'Não autorizado'},401);
  try{
    if(request.method==='GET')return privateJSON({...tradeConfigStatus(),control:await tradeControl()});
    if(request.method!=='POST')return privateJSON({error:'Método não permitido'},405);
    const body=await request.json();
    if(!body||Object.keys(body).sort().join(',')!=='armed,emergencyStop'||typeof body.armed!=='boolean'||typeof body.emergencyStop!=='boolean')
      return privateJSON({error:'Pedido inválido'},400);
    const control=await setTradeControl(body);
    return privateJSON({ok:true,control});
  }catch(e){return privateJSON({error:String(e.message).slice(0,100)},409)}
}
