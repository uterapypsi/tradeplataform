/* Endpoint de consulta privado. Sem operações de escrita. */
import {getStore} from '@netlify/blobs';
import {initialState} from '../lib/goldbot-core.mjs';
import {readEnv} from '../lib/goldbot-services.mjs';
import {isAuthorized, privateJSON} from '../lib/goldbot-auth.mjs';
export default async (req) => {
  if (req.method!=='GET')return privateJSON({error:'Método não permitido'},405);
  const token=readEnv('GOLDBOT_V2_ADMIN_TOKEN');
  if (!token || token.length < 24) return privateJSON({error:'Acesso não configurado'},503);
  if (!isAuthorized(req))return privateJSON({error:'Não autorizado'},401);
  try {
    const store=getStore({name:'goldbot-v2',consistency:'strong'});
    const [state,control]=await Promise.all([store.get('paper-state',{type:'json'}),store.get('control',{type:'json'})]);
    const masterEnabled=readEnv('GOLDBOT_V2_ENABLED')==='true';
    return privateJSON({enabled:masterEnabled&&control?.enabled===true, masterEnabled,
      requestedEnabled:control?.enabled===true,
      schedule:'15 * * * * (UTC; velas diárias)',
      state:state&&state.version===2?state:initialState(),
      caveat:'Paper trading: as saídas são avaliadas nos fechos diários, não são stops de mercado.'});
  } catch {return privateJSON({error:'Estado indisponível, consulta logs do Netlify'},503);}
};
